/**
 * POST /api/admin/hyrox/results/review — 完賽成績核可／拒絕（管理員限定）
 *
 * 契約：docs/HYROX完賽排行榜與數據整合-方案-20261122.md §1.5-④（定稿）
 *       Body { "id": "<uuid>", "action": "approve" | "reject",
 *              "admin_note": "…"（reject 必填） }
 *
 * 行為：
 *   ① 讀出該筆提交（含提交者姓名／類別／成績，給稽核摘要用）
 *   ② update status / admin_note / reviewed_by / reviewed_at
 *   ③ writeAuditLog(module='hyrox_results')：核可摘要照契約格式
 *      「核可 {display_name} {division_label} {finish_label}（{race_name}）」
 *   ④ revalidatePath('/hyrox/results')、revalidatePath('/admin/review')、
 *      revalidateTag('hyrox-results')（公開榜快取，方案 §1.5-⑤ 指定）
 *
 * v1 沒有任何積分邏輯（方案 §1.2「不加分」）；擴充位：approve 分支未來
 * 加 points 即可，契約不變。
 *
 * 降級（§1.5-⑥）：migration 未跑 → 400 SCHEMA_OUTDATED。
 *
 * Owner：白客（backend-engineer）
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { authorizeModule } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { HYROX_RESULTS_TAG } from "@/lib/queries";
import {
  isUuid,
  jsonConflict,
  jsonErr,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";

/** 拒絕原因上限（與 DB 的 hyrox_results_admin_note_len 同口徑） */
const ADMIN_NOTE_MAX = 500;

const ACTIONS = ["approve", "reject"] as const;

export async function GET() {
  return jsonMethodNotAllowed();
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;

export async function POST(request: Request) {
  try {
    // 歸 review 模組（不是 events）：三支都只服務 /admin/review 的「HYROX 成績」分頁，
    // 與 hyrox/review 屬同一審核工作流；歸 events 會讓「UI 在 review、守衛在 events」脫節。
    const auth = await authorizeModule("review", { write: true });
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    const body = await readJson(request);
    if (!body) return jsonValidation({}, "資料格式錯誤。");

    /* --- id --- */
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return jsonValidation({}, "缺少提交編號。");
    if (!isUuid(id)) return jsonValidation({ id: "編號格式錯誤。" });

    /* --- action --- */
    const action = typeof body.action === "string" ? body.action.trim() : "";
    if (!(ACTIONS as readonly string[]).includes(action)) {
      return jsonValidation({ action: "action 只接受 approve／reject。" });
    }

    /* --- admin_note：reject 必填（契約 ④）；approve 選填 --- */
    const adminNote =
      typeof body.admin_note === "string" ? body.admin_note.trim().slice(0, ADMIN_NOTE_MAX) : "";
    // 前端要求 ≥2 字；後端必須同口徑，否則「1 字」能繞過前端直接打到 API
    if (action === "reject" && adminNote.length < 2) {
      return jsonValidation({ admin_note: "請填寫拒絕原因（至少 2 個字）。" });
    }

    /* --- 讀出現況（稽核摘要要 before；順便判 404／409）--- */
    const { data: row, error: readErr } = await supabase
      .from("hyrox_results")
      .select(
        "id,status,division_code,finish_seconds,race_name," +
          "profile:profiles!hyrox_results_user_id_fkey(display_name)," +
          "division:hyrox_divisions(label)"
      )
      .eq("id", id)
      .maybeSingle();

    if (readErr) {
      if (isSchemaMissing(readErr)) return schemaOutdated();
      return jsonInternal("POST /api/admin/hyrox/results/review read", readErr);
    }
    if (!row) return jsonNotFound("找不到這筆提交。");

    // PostgREST 的回傳型別是含錯誤形狀的交集；經 unknown 轉成要用的形状
    const current = row as unknown as {
      id: string;
      status: "pending" | "approved" | "rejected";
      division_code: string;
      finish_seconds: number;
      race_name: string;
      profile: { display_name: string | null } | null;
      division: { label: string } | null;
    };

    if (current.status !== "pending") {
      return jsonConflict("這筆提交已經審核過了。");
    }

    /* --- 更新（RLS：results_admin_update 只放行管理員）--- */
    const nextStatus = action === "approve" ? "approved" : "rejected";
    const { error: updateErr } = await supabase
      .from("hyrox_results")
      .update({
        status: nextStatus,
        admin_note: adminNote === "" ? null : adminNote,
        reviewed_by: actorId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending"); // 樂觀鎖：審核期間狀態被別人改過就 0 列

    if (updateErr) {
      if (isSchemaMissing(updateErr)) return schemaOutdated();
      return jsonInternal("POST /api/admin/hyrox/results/review update", updateErr);
    }

    /* --- 稽核（best-effort，失敗不影響審核結果；摘要照契約格式）--- */
    const displayName = current.profile?.display_name ?? "未取得";
    const divisionLabel = current.division?.label ?? current.division_code;
    const finishLabel = formatFinish(current.finish_seconds);

    await writeAuditLog(
      supabase,
      actorId,
      "hyrox_results",
      action,
      action === "approve"
        ? `核可 ${displayName} ${divisionLabel} ${finishLabel}（${current.race_name}）`
        : `拒絕 ${displayName} ${divisionLabel} ${finishLabel}（${current.race_name}）` +
          (adminNote ? `，原因「${adminNote.slice(0, 60)}」` : "")
    );

    /* --- 快取失效：公開榜（tag）＋兩個頁面路徑（同 admin/hyrox/events 的做法）--- */
    revalidateTag(HYROX_RESULTS_TAG, { expire: 60 });
    revalidatePath("/hyrox/results");
    revalidatePath("/admin/review");

    return jsonOk({ message: action === "approve" ? "已確認。" : "已拒絕。" });
  } catch (err) {
    return jsonInternal("POST /api/admin/hyrox/results/review", err);
  }
}

/* =============================================================
 * 內部工具
 * ============================================================= */

/** 完賽秒數 → HH:MM:SS（與名單端點同一格式） */
function formatFinish(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function isSchemaMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  if (code === "42P01" || code === "PGRST205") return true;
  return /does not exist|schema cache/i.test(message) && /hyrox_(results|divisions)/i.test(message);
}

function schemaOutdated() {
  return jsonErr("完賽排行榜尚未開放，請稍後再試。", "SCHEMA_OUTDATED", 400);
}
