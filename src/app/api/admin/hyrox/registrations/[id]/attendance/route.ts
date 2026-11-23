/**
 * PATCH /api/admin/hyrox/registrations/[id]/attendance — 出席點名（管理員限定）
 *
 * Body: { attended: true | false }
 *   true  → attended_at = now()、attended_by = 管理員 id
 *   false → 兩欄一起清空（取消點名，可重複標記）
 *
 * 為什麼要有這支：站主目前只知道「誰報名、誰付款」，不知道「誰真的到場」。
 * 出席率、no-show、下個月值不值得續辦都靠這一欄。
 *
 * 【四個必查安全項】
 *   · 越權：authorizeAdmin()（未設定 400 / 未登入 401 / 非管理員 403）
 *   · IDOR：id 先驗 uuid；再確認這筆報名所屬場次 series='hyrox'
 *           （與 GET /api/admin/hyrox/registrations 同口徑，不讓一般活動的
 *            報名 id 從這支端點被改）
 *   · 參數：attended 只認 boolean true / false；字串 "true" 一律 400
 *   · 降級：migration 未跑（attended_at 欄位不存在 → 42703 / PGRST204）
 *           → 503 SCHEMA_OUTDATED，訊息含要執行的檔名
 *
 * 【會員不可改 attended（雙層，見 migration-event-attendance.sql §2）】
 *   政策層：event_registrations 只有 event_reg_admin_update（admin-only）。
 *   觸發器層：非管理員寫這兩個欄位會被 event_reg_guard_attendance 還原。
 *
 * 【快取】
 *   analytics 頁是 force-dynamic 直呼 RPC，專案內沒有 analytics 專用 tag，
 *   所以這裡用 revalidatePath("/admin/analytics")（如實記：不是 revalidateTag）。
 *
 * Owner：白客（backend-engineer）
 */

import { revalidatePath } from "next/cache"; import { authorizeModule } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import {
  isUuid,
  jsonErr,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

type RegistrationRow = {
  id: string;
  status: string;
  attended_at: string | null;
  attended_by: string | null;
  profile: { display_name: string | null; full_name: string | null } | null;
  event: { id: string; title: string; event_date: string; series: string | null } | null;
};

const NOT_FOUND_MSG = "找不到這筆報名。";

export async function GET() {
  return jsonMethodNotAllowed();
}
export const POST = GET;
export const PUT = GET;
export const DELETE = GET;

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    /* ── 越權：第一行就擋 ─────────────────────────────────── */
    const auth = await authorizeModule("events", { write: true });
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    /* ── IDOR 第一道：格式 ───────────────────────────────── */
    const { id } = await ctx.params;
    const registrationId = (id ?? "").trim();
    if (!isUuid(registrationId)) {
      return jsonValidation({ id: "報名編號格式錯誤。" });
    }

    /* ── 參數：attended 只認 boolean ─────────────────────── */
    const body = await readJson(request);
    if (!body) return jsonValidation({}, "資料格式錯誤。");

    const rawAttended = body.attended;
    if (typeof rawAttended !== "boolean") {
      return jsonValidation({ attended: "出席狀態必須是 true 或 false。" });
    }
    const attended = rawAttended;

    /* ── 讀出報名（含場次與會員名，給 IDOR 判斷與稽核摘要用）──
     *
     * select 刻意帶上 attended_at / attended_by：
     * migration 未跑時這裡就會回 42703 / PGRST204 → 提早回 503，
     * 而不是先做一次無用的 UPDATE 才失敗（也讓「功能未啟用」優先於 404，
     * 降級語意更明確）。 */
    const { data, error: readError } = await supabase
      .from("event_registrations")
      .select(
        "id,status,attended_at,attended_by," +
          // 兩條 FK 指向 profiles（user_id / reviewed_by），必須指定外鍵名
          "profile:profiles!event_registrations_user_id_fkey(display_name,full_name)," +
          "event:events(id,title,event_date,series)"
      )
      .eq("id", registrationId)
      .maybeSingle();

    if (readError) {
      if (isSchemaMissing(readError)) return schemaOutdated();
      return jsonInternal("PATCH /api/admin/hyrox/registrations/[id]/attendance read", readError);
    }
    if (!data) return jsonNotFound(NOT_FOUND_MSG);

    const row = data as unknown as RegistrationRow;

    /* ── IDOR 第二道：必須是 HYROX 場次的報名 ─────────────── */
    if (!row.event || row.event.series !== "hyrox") {
      return jsonNotFound(NOT_FOUND_MSG);
    }

    /* ── 寫入（true 蓋時間戳＋記錄誰標的；false 兩欄一起清）── */
    const { data: updated, error: updateError } = await supabase
      .from("event_registrations")
      .update(
        attended
          ? { attended_at: new Date().toISOString(), attended_by: actorId }
          : { attended_at: null, attended_by: null }
      )
      .eq("id", registrationId)
      .select("id, attended_at, attended_by")
      .maybeSingle();

    if (updateError) {
      if (isSchemaMissing(updateError)) return schemaOutdated();
      return jsonInternal("PATCH /api/admin/hyrox/registrations/[id]/attendance update", updateError);
    }
    if (!updated) return jsonNotFound(NOT_FOUND_MSG);

    /* ── 稽核（best-effort，失敗不影響點名結果）────────────── */
    const memberName =
      row.profile?.full_name?.trim() || row.profile?.display_name?.trim() || "未取得";
    const eventDate = row.event.event_date ?? "日期未取得";

    await writeAuditLog(
      supabase,
      actorId,
      "hyrox",
      "attendance",
      `標記 ${attended ? "出席" : "缺席"}：${memberName}（${eventDate}）`
    );

    /* ── 快取：分析頁（見檔頭說明，專案無 analytics tag）──── */
    revalidatePath("/admin/analytics");

    const saved = updated as unknown as {
      id: string;
      attended_at: string | null;
      attended_by: string | null;
    };

    return jsonOk({
      message: attended ? "已標記出席。" : "已標記缺席。",
      registration: {
        id: saved.id,
        attended_at: saved.attended_at,
        attended_by: saved.attended_by,
      },
    });
  } catch (err) {
    return jsonInternal("PATCH /api/admin/hyrox/registrations/[id]/attendance", err);
  }
}

/* =============================================================
 * 降級判斷（migration 未跑 → attended_at 欄位不存在）
 * ============================================================= */

/**
 * 欄位不存在：
 * - 42703 undefined_column
 * - PGRST204 PostgREST schema cache 找不到欄位
 * 其餘（含 42P01 表不存在）也一併視為 schema 未就緒。
 */
function isSchemaMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code)) return true;
  return /column .* does not exist|could not find the .*column|schema cache/i.test(message);
}

function schemaOutdated() {
  return jsonErr(
    "出席點名功能尚未啟用，請先執行 supabase/migration-event-attendance.sql。",
    "SCHEMA_OUTDATED",
    503
  );
}
