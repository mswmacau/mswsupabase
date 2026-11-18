/**
 * GET /api/races/[id]/me — 我在這場賽事的報名（會員端）
 *
 * 回應：200 { ok:true, registration:{…}|null, entries:[…] }
 *   · 沒有報名 → registration:null、entries:[]（鍵一定在，前端不用判斷 undefined）
 *   · 未登入 → 401；id 非 uuid → 400
 *   · 其他方法 → 405 JSON
 *
 * 【為什麼這支不驗「賽事是否對外可見」】
 * 會員的報名紀錄（含已取消的）在賽事下架（status='archived'）後仍應該看得到，
 * 否則會員中心會突然空白。race_registrations 的 select 政策只看
 * user_id = auth.uid()，不看賽事狀態，所以這裡直接查自己的那一筆即可；
 * 查不到就是 null，也不會洩漏任何別人或別的賽事的資料。
 * 副作用（已記錄在交付說明）：賽事被下架後，nested 的 race_categories 會因為
 * race_categories_select_public 而查不到 → entries[].category 為 null。
 *
 * 【安全】
 *   · 越權：requireMember() 未登入 401。
 *   · IDOR：查詢同時下 event_id + user_id 兩個條件（RLS 之外的第二道）。
 *   · 參數：id 先 isUuid（非 uuid 直接 400，不送進 Postgres 變 22P02 500）。
 *
 * Owner：白客（backend-engineer）
 */

import {
  isUuid,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonOk,
  jsonValidation,
} from "@/lib/api";
import { dbFail } from "@/app/api/admin/races/_shared";
import { readMyRegistration, requireMember } from "@/app/api/races/_shared";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const auth = await requireMember();
    if (!auth.ok) return auth.res;
    const { supabase, user } = auth.ctx;

    const { id } = await ctx.params;
    const eventId = (id ?? "").trim();
    if (!isUuid(eventId)) return jsonValidation({ id: "賽事編號格式錯誤。" });

    const { registration, entries, error } = await readMyRegistration(
      supabase,
      eventId,
      user.id
    );

    // 22P02（理論上被 isUuid 擋掉了）走 dbFail 的 400；其餘 500 並脫敏
    if (error) return dbFail("GET /api/races/[id]/me", error);

    return jsonOk({ registration, entries });
  } catch (err) {
    return jsonInternal("GET /api/races/[id]/me", err);
  }
}

export function POST() {
  return jsonMethodNotAllowed();
}

export function PATCH() {
  return jsonMethodNotAllowed();
}

export function DELETE() {
  return jsonMethodNotAllowed();
}
