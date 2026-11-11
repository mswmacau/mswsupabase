/**
 * POST /api/hyrox/register — 會員報名 HYROX 付費場次（同時上傳付款截圖）
 *
 * 契約（定稿）：
 *   { event_id, profile:{full_name,gender,phone,id_last4},
 *     answers:{group_pref,weekly_freq,longest_run},
 *     disclaimer_accepted:true, proof_path:"<uid>/1699999999-abcd.jpg" }
 *
 * 檢查順序（錯誤碼照契約，順序不可調換）：
 *   1) 未設定 Supabase        → 400 SUPABASE_NOT_CONFIGURED
 *   2) 未登入                 → 401 UNAUTHENTICATED
 *   3) body 畸形 / event_id 非 uuid → 400 VALIDATION（附 fields）
 *   4) 活動不存在或 series ≠ 'hyrox' → 404 NOT_FOUND
 *   5) status ≠ 'published' 或 event_date < today → 400 EVENT_CLOSED
 *   6) disclaimer_accepted ≠ true → 400 DISCLAIMER_REQUIRED
 *   7) answers 三欄任一空白   → 400 VALIDATION（fields 逐項）
 *   8) profile 四欄（required 模式）→ 400 VALIDATION
 *   9) proof_path 缺漏／不是自己的目錄／物件不存在 → 400 PROOF_REQUIRED
 *   10) 已報名               → 409 ALREADY_REGISTERED（unique 23505 為最終防線）
 *
 * 行為：
 *   ① 以本次送出的資料同步更新 profiles（實名資料是會員的最新版本）
 *   ② insert event_registrations（payment_status 交給 before-insert trigger，
 *      migration-paid-events-1.sql I 段，依 events.fee_cents 自動決定，**不自己寫**）
 *   ③ revalidatePath('/hyrox')、revalidatePath('/dashboard')
 *   ④ 回 { ok:true, registration:{ id, payment_status } }
 *
 * 安全要點：
 *   · user_id 一律取自 session，body 內的 user_id / id 一律忽略（不存在改他人資料的入口）
 *   · proof_path 必須落在 `${user.id}/` 之下（不能指到別人的截圖目錄）
 *   · 錯誤訊息不含 SQL、表名、Storage 路徑、他人資料
 *
 * H6：全支包 try/catch，任何情況都回 JSON。
 * Owner：白客（backend-engineer）
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { todayISO } from "@/lib/utils";
import { parseRealNameFields } from "@/lib/profile-fields";
import {
  isUuid,
  jsonBadJson,
  jsonDbError,
  jsonErr,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonNotConfigured,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";
import {
  HYROX_SERIES,
  hyroxErr,
  parseAnswers,
  parseProofPath,
  proofObjectExists,
} from "../_shared/contract";

export async function POST(request: Request) {
  try {
    // 1) 未連接 Supabase
    if (!isSupabaseConfigured) return jsonNotConfigured();

    const supabase = await createClient();
    if (!supabase) return jsonErr("客戶端初始化失敗。", "INTERNAL", 500);

    // 2) 未登入（getUser() 走 Supabase Auth，不是只讀 cookie）
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonUnauthenticated();

    // 3) body / event_id
    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
    if (!eventId) return jsonValidation({ event_id: "缺少活動。" });
    if (!isUuid(eventId)) return jsonValidation({ event_id: "編號格式錯誤。" });

    // 4) 活動存在且屬於 HYROX 系列（先查後寫，不讓 FK／trigger 錯誤變 500）
    const { data: event, error: eventErr } = await supabase
      .from("events")
      .select("id, series, status, event_date, fee_cents")
      .eq("id", eventId)
      .maybeSingle();

    if (eventErr) return jsonDbError("POST /api/hyrox/register read event", eventErr);
    if (!event || event.series !== HYROX_SERIES) {
      return jsonNotFound("找不到這個活動。");
    }

    // 5) 未上架／已過期。event_date 為 null（日期待定）時不做過期判定
    if (event.status !== "published") {
      return hyroxErr("EVENT_CLOSED", 400, "這個活動目前未開放報名。");
    }
    if (typeof event.event_date === "string" && event.event_date < todayISO()) {
      return hyroxErr("EVENT_CLOSED", 400, "這個活動已經結束。");
    }

    // 6) 免責聲明必須明確勾選（只認 boolean true，字串 "true" 不收）
    if (body.disclaimer_accepted !== true) {
      return hyroxErr("DISCLAIMER_REQUIRED", 400, "請先閱讀並同意活動免責聲明。");
    }

    // 7) 報名表三題
    const answers = parseAnswers(body.answers);
    if (!answers.ok) return jsonValidation(answers.fields);

    // 8) 實名四欄（與 /api/profile/complete 共用同一支驗證器，口徑完全一致）
    const profileInput =
      typeof body.profile === "object" && body.profile !== null && !Array.isArray(body.profile)
        ? (body.profile as Record<string, unknown>)
        : {};
    const parsedProfile = parseRealNameFields(profileInput, "required");
    if (!parsedProfile.ok) return jsonValidation(parsedProfile.fields);
    const { full_name, gender, phone, id_last4 } = parsedProfile.value;

    // 9) 付款截圖：形狀先在本地驗（白名單路徑），存在性再問 Storage
    const proof = parseProofPath(body.proof_path, user.id);
    if (!proof.ok) {
      return hyroxErr(
        "PROOF_REQUIRED",
        400,
        proof.reason === "missing"
          ? "請先上傳付款截圖。"
          : "付款截圖的路徑不正確，請重新上傳。"
      );
    }
    const proofExists = await proofObjectExists(supabase, proof.path);
    if (proofExists === false) {
      return hyroxErr("PROOF_REQUIRED", 400, "找不到你上傳的截圖，請重新上傳。");
    }

    // 10) 重複報名先查（給友好訊息）；unique 23505 是最終防線（並發雙擊）
    const { data: existing, error: existingErr } = await supabase
      .from("event_registrations")
      .select("id")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingErr) {
      return jsonDbError("POST /api/hyrox/register read existing", existingErr);
    }
    if (existing) {
      return hyroxErr("ALREADY_REGISTERED", 409, "你已經報名過這個活動。");
    }

    // ① 實名資料同步回 profiles（只改自己那一列；RLS profiles_update_own 雙重把關）
    const { error: profileErr } = await supabase
      .from("profiles")
      .update({ full_name, gender, phone, id_last4 })
      .eq("id", user.id);

    if (profileErr) {
      // 23514 = check 違反、22001 = 字串過長：DB 護欄與 API 驗證不一致才會走到
      if (profileErr.code === "23514" || profileErr.code === "22001") {
        return jsonValidation({}, "資料格式不正確，請檢查後再試。");
      }
      return jsonDbError("POST /api/hyrox/register update profile", profileErr);
    }

    // ② 寫入報名（刻意不送 payment_status：由 DB trigger 依 fee_cents 決定）
    const { data: reg, error: regErr } = await supabase
      .from("event_registrations")
      .insert({
        event_id: eventId,
        user_id: user.id,
        status: "registered",
        group_pref: answers.value.group_pref,
        weekly_freq: answers.value.weekly_freq,
        longest_run: answers.value.longest_run,
        disclaimer_accepted_at: new Date().toISOString(),
        payment_proof_path: proof.path,
        payment_amount_cents: Number(event.fee_cents ?? 0),
      })
      .select("id, payment_status")
      .single();

    if (regErr) {
      if (regErr.code === "23505") {
        return hyroxErr("ALREADY_REGISTERED", 409, "你已經報名過這個活動。");
      }
      return jsonDbError("POST /api/hyrox/register insert", regErr);
    }

    // ③ 前台 HYROX 頁與會員中心重新驗證
    revalidatePath("/hyrox");
    revalidatePath("/dashboard");

    // ④ 契約：只回 id 與 payment_status（付款狀態由 trigger 決定，不在這裡猜）
    return jsonOk({
      registration: {
        id: (reg as { id: string }).id,
        payment_status: (reg as { payment_status: string }).payment_status,
      },
    });
  } catch (err) {
    return jsonDbError("POST /api/hyrox/register", err);
  }
}

/** H6：未實作的方法也要回 JSON（复刻既有路由紀律） */
export async function GET() {
  return jsonMethodNotAllowed();
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
