/**
 * /api/admin/races/[id] — 更新／下架單場賽事（管理員限定）
 *
 * 方法：
 *   PATCH   只更新白名單欄位 → 200 { ok:true, event:{…} }
 *           status='archived' 就是「下架」（軟刪除，見下方說明）
 *   DELETE  一律拒絕（409）→ 請改用 PATCH status='archived'
 *   其他    405 JSON
 *
 * 【為什麼選「軟刪除」而不是 DELETE】
 * 賽事底下掛著 race_registrations（本名以外還有電話、付款截圖路徑、對帳狀態）
 * 與 race_entries。events 子表都是 on delete cascade，硬刪除等於一次把整場賽事的
 * 報名與付款紀錄不可逆地抹掉——稽核與對帳都做不了。
 * 因此 DELETE 明確拒絕並回可讀訊息；下架一律走 status='archived'，
 * 資料留著、前台 RLS（events_select_race_public 只看 open/closed/photos）自動看不到。
 *
 * 【四個必查安全項】
 *   · 越權：authorizeAdmin()。
 *   · IDOR：id 先驗 uuid；再 loadRace() 確認這筆真的是賽事（series='race'），
 *           不存在或屬於別的系列一律 404（不揭露別的模組的 id 是否存在）。
 *   · 參數：白名單解析（_shared.parseRaceFields）+ 日期區間與既有值交叉檢查；
 *           values 為空（只送了不相關的鍵）→ 400，不做空更新。
 *   · 分頁：無分頁參數。
 *
 * Owner：白客（backend-engineer）
 */

import { revalidateTag } from "next/cache";
import { authorizeAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { RACES_TAG } from "@/lib/races";
import {
  isUuid,
  jsonBadJson,
  jsonConflict,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";
import {
  RACE_EVENT_COLUMNS,
  RACE_NOT_FOUND_MSG,
  checkDateRange,
  dbFail,
  loadRace,
  parseRaceFields,
} from "@/app/api/admin/races/_shared";

const HARD_DELETE_MSG =
  "賽事不支援硬刪除（報名與付款紀錄需留存），請改為 PATCH status='archived' 下架。";

export function GET() {
  return jsonMethodNotAllowed();
}

export function POST() {
  return jsonMethodNotAllowed();
}

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    const { id } = await ctx.params;
    const eventId = (id ?? "").trim();
    if (!isUuid(eventId)) return jsonValidation({ id: "賽事編號格式錯誤。" });

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const parsed = parseRaceFields(body, "update");
    if (!parsed.ok) return jsonValidation(parsed.fields);

    if (Object.keys(parsed.values).length === 0) {
      return jsonValidation({}, "沒有可更新的欄位。");
    }

    // IDOR／存在性：先確認這是一場賽事，順便把既有日期取回來做區間檢查
    const { row: existing, error: guardErr } = await loadRace(supabase, eventId);
    if (guardErr) return dbFail("PATCH /api/admin/races/[id] guard", guardErr);
    if (!existing) return jsonNotFound(RACE_NOT_FOUND_MSG);

    const nextStart =
      typeof parsed.values.event_date === "string" ? parsed.values.event_date : existing.event_date;
    const nextEnd =
      parsed.values.end_date !== undefined
        ? (parsed.values.end_date as string | null)
        : existing.end_date;

    const rangeErr = checkDateRange(nextStart, nextEnd);
    if (Object.keys(rangeErr).length > 0) return jsonValidation(rangeErr);

    const { data, error } = await supabase
      .from("events")
      .update(parsed.values)
      .eq("id", eventId)
      .eq("series", "race")
      .select(RACE_EVENT_COLUMNS)
      .maybeSingle();

    if (error) return dbFail("PATCH /api/admin/races/[id] update", error);
    if (!data) return jsonNotFound(RACE_NOT_FOUND_MSG);

    revalidateTag(RACES_TAG, { expire: 60 });

    const changed = Object.keys(parsed.values).join("、");
    await writeAuditLog(
      supabase,
      actorId,
      "races",
      parsed.values.status === "archived" ? "archive" : "update",
      `更新賽事「${String(existing.title ?? "").slice(0, 40)}」（${changed}）`
    );

    return jsonOk({ event: data });
  } catch (err) {
    return jsonInternal("PATCH /api/admin/races/[id]", err);
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;

    const { id } = await ctx.params;
    const eventId = (id ?? "").trim();
    if (!isUuid(eventId)) return jsonValidation({ id: "賽事編號格式錯誤。" });

    // 仍然要分辨 400 / 404 / 409：測試會逐項核對，不能一律 409
    const { row: existing, error } = await loadRace(auth.supabase, eventId);
    if (error) return dbFail("DELETE /api/admin/races/[id] guard", error);
    if (!existing) return jsonNotFound(RACE_NOT_FOUND_MSG);

    return jsonConflict(HARD_DELETE_MSG);
  } catch (err) {
    return jsonInternal("DELETE /api/admin/races/[id]", err);
  }
}
