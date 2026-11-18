/**
 * /api/admin/races/categories — 賽事組別的新增／修改／刪除（管理員限定）
 *
 * 方法：
 *   POST   { event_id, day, name, team_size?, fee_cents?, sort_order? }
 *          → 201 { ok:true, category:{…} }
 *   PATCH  { id, day?, name?, team_size?, fee_cents?, sort_order? }
 *          → 200 { ok:true, category:{…} }
 *   DELETE { id }（也接受 ?id=）→ 200 { ok:true, removed:<id> }
 *   其他   405 JSON
 *
 * 【為什麼 PATCH / DELETE 用 body 而不是動態路由】
 * 契約把三個方法都掛在同一個路徑上；組別數量少、單次只動一筆，
 * body 帶 id 比再開一層 /categories/[id] 少一個檔案、也少一層 params 解析。
 *
 * 【四個必查安全項】
 *   · 越權：authorizeAdmin()。
 *   · IDOR：event_id 必須真的是賽事（loadRace）；PATCH／DELETE 的 id 先查回
 *           所屬 event_id 再驗一次，不能藉這支端點動到別的賽事的組別。
 *   · 參數：name 1–60 字、team_size 1–8、fee_cents 0–10,000,000、sort_order ±9999、
 *           day 必須落在該賽事的 event_date～coalesce(end_date,event_date)。
 *   · 分頁：無分頁參數，但列表查詢有 limit 200 保護。
 *
 * 【刪除閘門】組別已有報名（race_entries）時回 409 IN_USE，不做 cascade 靜默清空
 * 使用者的報名紀錄。
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
  jsonInUse,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";
import {
  CATEGORY_NAME_MAX,
  CATEGORY_NOT_FOUND_MSG,
  FEE_MAX,
  FEE_MIN,
  RACE_NOT_FOUND_MSG,
  SORT_MAX,
  SORT_MIN,
  TEAM_SIZE_MAX,
  TEAM_SIZE_MIN,
  dbFail,
  isDateOnly,
  loadRace,
} from "@/app/api/admin/races/_shared";

/** 依日期、再依 sort_order */
const CATEGORY_COLUMNS = "id,event_id,day,name,team_size,fee_cents,sort_order,created_at";

/** 同一 event+day 新增時的排序間隔 */
const SORT_STEP = 10;

function cpLength(s: string): number {
  return Array.from(s).length;
}

type CategoryValues = Record<string, unknown>;

/** 組別欄位白名單解析（create 時 day / name 必填） */
function parseCategoryFields(
  body: Record<string, unknown>,
  mode: "create" | "update"
):
  | { ok: true; values: CategoryValues }
  | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const values: CategoryValues = {};

  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  /* day */
  if (has("day")) {
    if (isDateOnly(body.day)) values.day = body.day;
    else fields.day = "比賽日必須是 YYYY-MM-DD 格式的合法日期。";
  } else if (mode === "create") {
    fields.day = "請填寫比賽日。";
  }

  /* name */
  if (has("name")) {
    const raw = body.name;
    if (typeof raw !== "string" || raw.trim() === "") fields.name = "請填寫組別名稱。";
    else if (cpLength(raw.trim()) > CATEGORY_NAME_MAX) {
      fields.name = `組別名稱最多 ${CATEGORY_NAME_MAX} 個字。`;
    } else values.name = raw.trim();
  } else if (mode === "create") {
    fields.name = "請填寫組別名稱。";
  }

  /* team_size（1–8） */
  if (has("team_size")) {
    const n = typeof body.team_size === "number" ? body.team_size : Number(body.team_size);
    if (!Number.isInteger(n) || n < TEAM_SIZE_MIN || n > TEAM_SIZE_MAX) {
      fields.team_size = `每組人數必須介於 ${TEAM_SIZE_MIN} 到 ${TEAM_SIZE_MAX}。`;
    } else values.team_size = n;
  }

  /* fee_cents（0–10,000,000） */
  if (has("fee_cents")) {
    const n = typeof body.fee_cents === "number" ? body.fee_cents : Number(body.fee_cents);
    if (!Number.isInteger(n) || n < FEE_MIN || n > FEE_MAX) {
      fields.fee_cents = `報名費必須介於 ${FEE_MIN} 到 ${FEE_MAX}（分）。`;
    } else values.fee_cents = n;
  }

  /* sort_order（±9999） */
  if (has("sort_order")) {
    const n = typeof body.sort_order === "number" ? body.sort_order : Number(body.sort_order);
    if (!Number.isInteger(n) || n < SORT_MIN || n > SORT_MAX) {
      fields.sort_order = `排序必須介於 ${SORT_MIN} 到 ${SORT_MAX}。`;
    } else values.sort_order = n;
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, values };
}

/** day 必須落在賽事日期區間內 */
function dayRangeError(
  day: string,
  event: { event_date: string; end_date: string | null }
): string | null {
  const last = event.end_date ?? event.event_date;
  if (day < event.event_date || day > last) {
    return `比賽日必須在賽事日期範圍內（${event.event_date} 至 ${last}）。`;
  }
  return null;
}

export function GET() {
  return jsonMethodNotAllowed();
}

/* =============================================================
 * POST — 新增組別
 * ============================================================= */
export async function POST(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    if (!isUuid(body.event_id)) return jsonValidation({ event_id: "賽事編號格式錯誤。" });
    const eventId = String(body.event_id).trim();

    const parsed = parseCategoryFields(body, "create");
    if (!parsed.ok) return jsonValidation(parsed.fields);

    const { row: event, error: guardErr } = await loadRace(supabase, eventId);
    if (guardErr) return dbFail("POST /api/admin/races/categories guard", guardErr);
    if (!event) return jsonNotFound(RACE_NOT_FOUND_MSG);

    const day = String(parsed.values.day);
    const rangeErr = dayRangeError(day, event);
    if (rangeErr) return jsonValidation({ day: rangeErr });

    // sort_order 未給：接在同一天現有最大值後面，留 SORT_STEP 間隔
    let sortOrder = parsed.values.sort_order as number | undefined;
    if (sortOrder === undefined) {
      const { data: lastRow, error: lastErr } = await supabase
        .from("race_categories")
        .select("sort_order")
        .eq("event_id", eventId)
        .eq("day", day)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastErr) return dbFail("POST /api/admin/races/categories sort probe", lastErr);
      const last = Number((lastRow as { sort_order?: number } | null)?.sort_order ?? 0);
      sortOrder = last + SORT_STEP;
    }

    const { data, error } = await supabase
      .from("race_categories")
      .insert({
        event_id: eventId,
        day,
        name: parsed.values.name,
        team_size: parsed.values.team_size ?? 1,
        fee_cents: parsed.values.fee_cents ?? 0,
        sort_order: sortOrder,
      })
      .select(CATEGORY_COLUMNS)
      .single();

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return jsonConflict("同一天已經有同名組別。");
      }
      return dbFail("POST /api/admin/races/categories insert", error);
    }

    revalidateTag(RACES_TAG, { expire: 60 });
    await writeAuditLog(
      supabase,
      actorId,
      "races",
      "category-add",
      `新增組別「${String(parsed.values.name).slice(0, 30)}」（${day}）`
    );

    return jsonOk({ category: data }, 201);
  } catch (err) {
    return jsonInternal("POST /api/admin/races/categories", err);
  }
}

/* =============================================================
 * PATCH — 修改組別
 * ============================================================= */
export async function PATCH(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    if (!isUuid(body.id)) return jsonValidation({ id: "組別編號格式錯誤。" });
    const categoryId = String(body.id).trim();

    const parsed = parseCategoryFields(body, "update");
    if (!parsed.ok) return jsonValidation(parsed.fields);
    if (Object.keys(parsed.values).length === 0) {
      return jsonValidation({}, "沒有可更新的欄位。");
    }

    // IDOR：先查回所屬賽事，不能改到別的賽事的組別
    const { data: current, error: readErr } = await supabase
      .from("race_categories")
      .select("id,event_id,day,name")
      .eq("id", categoryId)
      .maybeSingle();

    if (readErr) return dbFail("PATCH /api/admin/races/categories read", readErr);
    if (!current) return jsonNotFound(CATEGORY_NOT_FOUND_MSG);

    const currentRow = current as unknown as { id: string; event_id: string; day: string; name: string };

    const { row: event, error: guardErr } = await loadRace(supabase, currentRow.event_id);
    if (guardErr) return dbFail("PATCH /api/admin/races/categories guard", guardErr);
    if (!event) return jsonNotFound(RACE_NOT_FOUND_MSG);

    if (typeof parsed.values.day === "string") {
      const rangeErr = dayRangeError(parsed.values.day, event);
      if (rangeErr) return jsonValidation({ day: rangeErr });
    }

    const { data, error } = await supabase
      .from("race_categories")
      .update(parsed.values)
      .eq("id", categoryId)
      .eq("event_id", currentRow.event_id)
      .select(CATEGORY_COLUMNS)
      .maybeSingle();

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return jsonConflict("同一天已經有同名組別。");
      }
      return dbFail("PATCH /api/admin/races/categories update", error);
    }
    if (!data) return jsonNotFound(CATEGORY_NOT_FOUND_MSG);

    revalidateTag(RACES_TAG, { expire: 60 });
    await writeAuditLog(
      supabase,
      actorId,
      "races",
      "category-update",
      `修改組別「${currentRow.name.slice(0, 30)}」（${Object.keys(parsed.values).join("、")}）`
    );

    return jsonOk({ category: data });
  } catch (err) {
    return jsonInternal("PATCH /api/admin/races/categories", err);
  }
}

/* =============================================================
 * DELETE — 刪除組別（已有報名則拒絕）
 * ============================================================= */
export async function DELETE(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    // body 優先；沒 body 時接受 ?id=（curl 比較好寫）
    let rawId: unknown = new URL(request.url).searchParams.get("id");
    const body = await readJson(request);
    if (body && body.id !== undefined) rawId = body.id;

    if (!isUuid(rawId)) return jsonValidation({ id: "組別編號格式錯誤。" });
    const categoryId = String(rawId).trim();

    const { data: current, error: readErr } = await supabase
      .from("race_categories")
      .select("id,event_id,day,name")
      .eq("id", categoryId)
      .maybeSingle();

    if (readErr) return dbFail("DELETE /api/admin/races/categories read", readErr);
    if (!current) return jsonNotFound(CATEGORY_NOT_FOUND_MSG);

    const currentRow = current as unknown as { id: string; event_id: string; day: string; name: string };

    const { row: event, error: guardErr } = await loadRace(supabase, currentRow.event_id);
    if (guardErr) return dbFail("DELETE /api/admin/races/categories guard", guardErr);
    if (!event) return jsonNotFound(RACE_NOT_FOUND_MSG);

    // 刪除閘門：已有報名就不刪（不讓使用者的報名紀錄被 cascade 靜默清掉）
    const { count, error: countErr } = await supabase
      .from("race_entries")
      .select("id", { count: "exact", head: true })
      .eq("category_id", categoryId);

    if (countErr) return dbFail("DELETE /api/admin/races/categories count", countErr);
    if ((count ?? 0) > 0) {
      return jsonInUse(
        `這個組別已有 ${count} 筆報名，請先請對方取消或改組再刪除。`
      );
    }

    const { error } = await supabase
      .from("race_categories")
      .delete()
      .eq("id", categoryId)
      .eq("event_id", currentRow.event_id);

    if (error) return dbFail("DELETE /api/admin/races/categories delete", error);

    revalidateTag(RACES_TAG, { expire: 60 });
    await writeAuditLog(
      supabase,
      actorId,
      "races",
      "category-delete",
      `刪除組別「${currentRow.name.slice(0, 30)}」（${currentRow.day}）`
    );

    return jsonOk({ removed: categoryId });
  } catch (err) {
    return jsonInternal("DELETE /api/admin/races/categories", err);
  }
}
