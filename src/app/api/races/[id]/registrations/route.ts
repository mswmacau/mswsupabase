/**
 * /api/races/[id]/registrations — 我在這場賽事的報名（會員端）
 *
 * 方法（全部需要登入）：
 *   GET    不支援 → 405（要讀自己的報名請用 /api/races/[id]/me）
 *   POST   建立報名        → 200 { ok:true, registration:{…}, entries:[…] }
 *   PATCH  更新自己的報名  → 200 { ok:true, registration:{…}, entries:[…] }
 *   DELETE 取消報名（軟取消，status='cancelled'）→ 200 { ok:true, message }
 *
 * 【寫入順序與補償（本檔最重要的兩段）】
 *   POST ：先 insert race_registrations → 再 insert race_entries；
 *          entries 失敗就把剛建立的 registration 刪掉，絕不留半筆。
 *   PATCH：entries 採「全量替換」——先刪除舊 entries 再重建。
 *          刪除前先把舊的 (category_id, teammate_names) 抄下來，
 *          新 entries 寫入失敗時把它們寫回去（PostgREST 沒有跨語句交易，
 *          這是等效的補償動作）。補償本身也失敗時寫 server log 並回 500，
 *          不假裝成功。
 *
 * 【狀態機】
 *   · 新報名 status='submitted'；payment_status 依賽事＋組別費用判斷
 *     （全為 0 → not_required，否則 pending）。
 *   · PATCH 一律把 status 寫回 'submitted'，讓管理員重新確認——
 *     這同時是 RLS 的要求：race_registrations_update_own 的 with check 只允許
 *     status in ('submitted','cancelled')，不帶 submitted 的更新在 'confirmed'
 *     的列上會被政策擋掉（42501）。
 *   · payment_status 觸發器會把非管理員寫的值還原，所以本檔**不送**這個欄位。
 *
 * 【四個必查安全項】
 *   · 越權：requireMember() 401；所有查詢再以 user_id 明示。
 *   · IDOR：registration 一律用 (event_id, user_id) 兩條件定位；
 *           body 裡的 user_id / event_id / status / payment_status / id 全部忽略。
 *   · 參數：見 _shared.parseRegistrationBody（長度、上下界、列舉、組別歸屬、重複）。
 *   · 分頁：無（單筆）。
 *
 * Owner：白客（backend-engineer）
 */

import { revalidateTag } from "next/cache";
import { RACES_TAG } from "@/lib/races";
import {
  isUuid,
  jsonBadJson,
  jsonConflict,
  jsonForbidden,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";
import { dbFail } from "@/app/api/admin/races/_shared";
import {
  CANCELLED_EDIT_MSG,
  CLOSED_EDIT_MSG,
  RACE_NOT_FOUND_MSG,
  REGISTRATION_NOT_FOUND_MSG,
  acceptingError,
  decidePaymentStatus,
  loadEventCategories,
  loadMemberRace,
  parseRegistrationBody,
  readMyRegistration,
  requireMember,
} from "@/app/api/races/_shared";

type Ctx = { params: Promise<{ id: string }> };

const ALREADY_REGISTERED_MSG = "你已經報名過這場賽事了，如需修改請到會員中心。";
const CANCELLED_RE_REGISTER_MSG =
  "你在這場賽事的報名已取消，如需重新報名請聯絡教練。";
const CLOSED_CONFLICT_MSG = "這場賽事的報名已截止。";

type PgErr = { code?: unknown };

function pgCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const code = (error as PgErr).code;
  return typeof code === "string" ? code : "";
}

/** 讀路徑上的賽事 id（非 uuid 直接 400，不送進 Postgres 變 22P02 500） */
function readEventId(id: string | undefined): string | null {
  const value = (id ?? "").trim();
  return isUuid(value) ? value : null;
}

export function GET() {
  return jsonMethodNotAllowed();
}

/* =============================================================
 * POST — 建立報名
 * ============================================================= */
export async function POST(request: Request, ctx: Ctx) {
  try {
    const auth = await requireMember();
    if (!auth.ok) return auth.res;
    const { supabase, user } = auth.ctx;

    const { id } = await ctx.params;
    const eventId = readEventId(id);
    if (!eventId) return jsonValidation({ id: "賽事編號格式錯誤。" });

    /* --- 賽事守門：存在、series='race'、開放報名中 --- */
    const { row: race, error: raceErr } = await loadMemberRace(supabase, eventId);
    if (raceErr) return dbFail("POST /api/races/[id]/registrations race", raceErr);
    if (!race) return jsonNotFound(RACE_NOT_FOUND_MSG);

    const blocked = acceptingError(race);
    if (blocked) return jsonConflict(blocked);

    /* --- body --- */
    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const parsed = parseRegistrationBody(body);
    if (!parsed.ok) return jsonValidation(parsed.fields);

    /* --- 組別必須屬於這場賽事 --- */
    const { rows: categories, error: catErr } = await loadEventCategories(
      supabase,
      eventId,
      parsed.value.entries.map((e) => e.category_id)
    );
    if (catErr) return jsonValidation({ entries: catErr });

    /* --- 已報名？（先查一次好回精準訊息；23505 仍是第二道） --- */
    const { data: existing, error: existErr } = await supabase
      .from("race_registrations")
      .select("id,status")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existErr) return dbFail("POST /api/races/[id]/registrations exists", existErr);
    if (existing) {
      const status = (existing as { status?: string }).status;
      return jsonConflict(
        status === "cancelled" ? CANCELLED_RE_REGISTER_MSG : ALREADY_REGISTERED_MSG
      );
    }

    const paymentStatus = decidePaymentStatus(race, categories);

    /* --- 第一段：registration --- */
    const { data: created, error: insErr } = await supabase
      .from("race_registrations")
      .insert({
        event_id: eventId,
        user_id: user.id,
        full_name: parsed.value.full_name,
        phone: parsed.value.phone,
        gender: parsed.value.gender,
        needs_bus: parsed.value.needs_bus,
        bus_seats: parsed.value.bus_seats,
        needs_lodging: parsed.value.needs_lodging,
        lodging_people: parsed.value.lodging_people,
        lodging_nights: parsed.value.lodging_nights,
        member_note: parsed.value.member_note,
        status: "submitted",
        payment_status: paymentStatus,
      })
      .select("id")
      .single();

    if (insErr) {
      const code = pgCode(insErr);
      if (code === "23505") return jsonConflict(ALREADY_REGISTERED_MSG);
      // 42501：RLS 擋下（賽事剛好在這一瞬間截止／關閉）
      if (code === "42501") return jsonConflict(CLOSED_CONFLICT_MSG);
      return dbFail("POST /api/races/[id]/registrations insert", insErr);
    }

    const registrationId = String((created as { id: string }).id);

    /* --- 第二段：entries（失敗要補償刪掉剛建的 registration） --- */
    const { error: entErr } = await supabase.from("race_entries").insert(
      parsed.value.entries.map((e) => ({
        registration_id: registrationId,
        category_id: e.category_id,
        teammate_names: e.teammate_names,
      }))
    );

    if (entErr) {
      const { error: delErr } = await supabase
        .from("race_registrations")
        .delete()
        .eq("id", registrationId)
        .eq("user_id", user.id);

      if (delErr) {
        // 補償失敗：留一筆沒有 entries 的報名，後台仍看得到、可以處理，但必須留痕
        console.error(
          "[api] POST /api/races/[id]/registrations 補償刪除失敗：",
          delErr.message
        );
      }

      if (pgCode(entErr) === "23505") {
        return jsonConflict("同一個組別不可重複報名。");
      }
      return dbFail("POST /api/races/[id]/registrations entries", entErr);
    }

    revalidateTag(RACES_TAG, { expire: 60 });

    const view = await readMyRegistration(supabase, eventId, user.id);
    if (view.error) return dbFail("POST /api/races/[id]/registrations readback", view.error);

    return jsonOk({ registration: view.registration, entries: view.entries });
  } catch (err) {
    return jsonInternal("POST /api/races/[id]/registrations", err);
  }
}

/* =============================================================
 * PATCH — 更新自己的報名（entries 全量替換）
 * ============================================================= */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const auth = await requireMember();
    if (!auth.ok) return auth.res;
    const { supabase, user } = auth.ctx;

    const { id } = await ctx.params;
    const eventId = readEventId(id);
    if (!eventId) return jsonValidation({ id: "賽事編號格式錯誤。" });

    const { row: race, error: raceErr } = await loadMemberRace(supabase, eventId);
    if (raceErr) return dbFail("PATCH /api/races/[id]/registrations race", raceErr);
    if (!race) return jsonNotFound(RACE_NOT_FOUND_MSG);

    if (acceptingError(race)) return jsonConflict(CLOSED_EDIT_MSG);

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const parsed = parseRegistrationBody(body);
    if (!parsed.ok) return jsonValidation(parsed.fields);

    // 只做歸屬驗證：PATCH 不改費用，payment_status 由觸發器保護，不需要重算
    const { error: catErr } = await loadEventCategories(
      supabase,
      eventId,
      parsed.value.entries.map((e) => e.category_id)
    );
    if (catErr) return jsonValidation({ entries: catErr });

    /* --- 找到自己的那一筆（IDOR：event_id + user_id 雙條件） --- */
    const { data: currentRow, error: curErr } = await supabase
      .from("race_registrations")
      .select("id,status,payment_status")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (curErr) return dbFail("PATCH /api/races/[id]/registrations read", curErr);
    if (!currentRow) return jsonNotFound(REGISTRATION_NOT_FOUND_MSG);

    const current = currentRow as { id: string; status: string; payment_status: string };
    if (current.status === "cancelled") return jsonConflict(CANCELLED_EDIT_MSG);

    const registrationId = current.id;

    /* --- 先把舊 entries 抄下來，供補償用 --- */
    const { data: oldEntriesRaw, error: oldErr } = await supabase
      .from("race_entries")
      .select("category_id,teammate_names")
      .eq("registration_id", registrationId);

    if (oldErr) return dbFail("PATCH /api/races/[id]/registrations old entries", oldErr);
    const oldEntries = ((oldEntriesRaw as unknown as Array<{
      category_id: string;
      teammate_names: string | null;
    }> | null) ?? []).map((e) => ({
      registration_id: registrationId,
      category_id: e.category_id,
      teammate_names: e.teammate_names ?? null,
    }));

    /* --- 更新 registration（不送 payment_status；status 強制回 submitted） --- */
    const { data: updated, error: updErr } = await supabase
      .from("race_registrations")
      .update({
        full_name: parsed.value.full_name,
        phone: parsed.value.phone,
        gender: parsed.value.gender,
        needs_bus: parsed.value.needs_bus,
        bus_seats: parsed.value.bus_seats,
        needs_lodging: parsed.value.needs_lodging,
        lodging_people: parsed.value.lodging_people,
        lodging_nights: parsed.value.lodging_nights,
        member_note: parsed.value.member_note,
        status: "submitted",
      })
      .eq("id", registrationId)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (updErr) {
      if (pgCode(updErr) === "42501") return jsonConflict(CLOSED_EDIT_MSG);
      return dbFail("PATCH /api/races/[id]/registrations update", updErr);
    }
    // 0 列被更新＝RLS 擋下（賽事在這一瞬間截止），不是資料不存在
    if (!updated) return jsonConflict(CLOSED_EDIT_MSG);

    /* --- entries 全量替換：先刪後建 --- */
    const { error: delErr } = await supabase
      .from("race_entries")
      .delete()
      .eq("registration_id", registrationId);

    if (delErr) return dbFail("PATCH /api/races/[id]/registrations delete entries", delErr);

    const { error: insErr } = await supabase.from("race_entries").insert(
      parsed.value.entries.map((e) => ({
        registration_id: registrationId,
        category_id: e.category_id,
        teammate_names: e.teammate_names,
      }))
    );

    if (insErr) {
      // 補償：把舊 entries 寫回去，回到呼叫前的狀態
      if (oldEntries.length > 0) {
        const { error: restoreErr } = await supabase.from("race_entries").insert(oldEntries);
        if (restoreErr) {
          console.error(
            "[api] PATCH /api/races/[id]/registrations 補償還原 entries 失敗：",
            restoreErr.message
          );
          return jsonInternal(
            "PATCH /api/races/[id]/registrations restore entries",
            restoreErr
          );
        }
      }
      if (pgCode(insErr) === "23505") {
        return jsonConflict("同一個組別不可重複報名。");
      }
      return dbFail("PATCH /api/races/[id]/registrations insert entries", insErr);
    }

    revalidateTag(RACES_TAG, { expire: 60 });

    const view = await readMyRegistration(supabase, eventId, user.id);
    if (view.error) return dbFail("PATCH /api/races/[id]/registrations readback", view.error);

    return jsonOk({ registration: view.registration, entries: view.entries });
  } catch (err) {
    return jsonInternal("PATCH /api/races/[id]/registrations", err);
  }
}

/* =============================================================
 * DELETE — 取消報名（軟取消，保留對帳紀錄）
 * ============================================================= */
export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    const auth = await requireMember();
    if (!auth.ok) return auth.res;
    const { supabase, user } = auth.ctx;

    const { id } = await ctx.params;
    const eventId = readEventId(id);
    if (!eventId) return jsonValidation({ id: "賽事編號格式錯誤。" });

    const { row: race, error: raceErr } = await loadMemberRace(supabase, eventId);
    if (raceErr) return dbFail("DELETE /api/races/[id]/registrations race", raceErr);
    if (!race) return jsonNotFound(RACE_NOT_FOUND_MSG);

    const { data: currentRow, error: curErr } = await supabase
      .from("race_registrations")
      .select("id,status")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (curErr) return dbFail("DELETE /api/races/[id]/registrations read", curErr);
    if (!currentRow) return jsonNotFound(REGISTRATION_NOT_FOUND_MSG);

    const current = currentRow as { id: string; status: string };
    if (current.status === "cancelled") {
      // 冪等：已經取消過就回 200，不要讓重複點擊變成錯誤
      return jsonOk({ message: "這筆報名已經是取消狀態。", status: "cancelled" });
    }

    const { data: updated, error: updErr } = await supabase
      .from("race_registrations")
      .update({ status: "cancelled" })
      .eq("id", current.id)
      .eq("user_id", user.id)
      .select("id,status")
      .maybeSingle();

    if (updErr) {
      if (pgCode(updErr) === "42501") {
        return jsonConflict("報名已截止，無法線上取消，請聯絡教練。");
      }
      return dbFail("DELETE /api/races/[id]/registrations update", updErr);
    }

    // 0 列＝RLS 的 using 條件不成立。race_registrations_update_own 要求
    // race_event_accepting(event_id)，所以賽事截止後會員連「取消」都會被擋。
    // 這是資料庫政策的限制（不是本 API 的選擇），照實告訴會員要找教練。
    if (!updated) {
      const blocked = acceptingError(race);
      if (blocked) {
        return jsonConflict(
          `報名已截止，無法線上取消（${blocked}）如需取消請聯絡教練。`
        );
      }
      return jsonForbidden();
    }

    revalidateTag(RACES_TAG, { expire: 60 });

    return jsonOk({
      message: "已取消報名，如需恢復請聯絡教練。",
      status: "cancelled",
    });
  } catch (err) {
    return jsonInternal("DELETE /api/races/[id]/registrations", err);
  }
}
