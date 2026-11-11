/**
 * /api/profile/complete — 登入會員補填／更新自己的實名資料
 *
 * POST { full_name, gender, phone, id_last4 } → 200 { ok: true }
 *
 * 契約來源：交付需求「付費活動（HYROX）＋會員實名資料」交付 2-3。
 * 資料表：profiles.full_name / gender / id_last4（migration-paid-events-1.sql A 段）
 *
 * 【檢查鏈】
 *   1) isSupabaseConfigured → 400 SUPABASE_NOT_CONFIGURED
 *   2) 客戶端初始化失敗 → 500（不假裝成功）
 *   3) 未登入 → 401 UNAUTHENTICATED（getUser() 走 Supabase Auth，非只讀 cookie）
 *   4) body 畸形 → 400 VALIDATION
 *   5) 四個欄位嚴格驗證（姓名 2–40 字、性別枚舉、澳門電話 8 位可帶 +853、
 *      證件後四位 4 位數字）→ 400 VALIDATION + fields
 *   6) 更新 profiles（只更新自己的列：where id = auth.uid()，另有 RLS
 *      profiles_update_own 雙重把關）→ 更新的列數為 0 時回 404
 *
 * 【安全】
 *   · 越權：不接受 body 內的 user_id / id，一律用 session 的 user.id
 *     （就算前端送了也會被忽略，不存在改別人資料的入口）。
 *   · 敏感欄位（role / points / total_km / status）不在 update payload 內；
 *     就算之後有人加進來，guard_profile_sensitive_fields 也會在 DB 還原。
 *   · 錯誤訊息不含 SQL、表名、欄位路徑或堆疊。
 *
 * H6：全部包 try/catch，任何情況都回 JSON。
 */

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  jsonBadJson,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonNotConfigured,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";
import { parseRealNameFields } from "@/lib/profile-fields";

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured) return jsonNotConfigured();

    const supabase = await createClient();
    if (!supabase) return jsonInternal("POST /api/profile/complete client");

    // 3) 未登入 → 401
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonUnauthenticated();

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    // 5) 四欄全必填（這支端點的用途就是「補完實名資料」）
    const parsed = parseRealNameFields(body, "required");
    if (!parsed.ok) return jsonValidation(parsed.fields);
    const { full_name, gender, phone, id_last4 } = parsed.value;

    // 6) 只改自己的列；.select("id") 用來確認真的更新到 1 列
    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ full_name, gender, phone, id_last4 })
      .eq("id", user.id)
      .select("id");

    if (error) {
      // 23514 = check 違反（DB 護欄與 API 驗證不一致時才會走到）
      if (error.code === "23514" || error.code === "22001") {
        return jsonValidation({}, "資料格式不正確，請檢查後再試。");
      }
      return jsonInternal("POST /api/profile/complete update", error);
    }

    if (!updated || updated.length === 0) {
      // profile 尚未建立（例如註冊流程中斷）或 RLS 擋下 → 讓使用者重新登入
      return jsonNotFound("找不到你的會員資料，請重新登入後再試。");
    }

    return jsonOk({ message: "實名資料已更新。" });
  } catch (err) {
    return jsonInternal("POST /api/profile/complete", err);
  }
}

/** H6：未實作的方法也要回 JSON（复刻 event-registrations 路由紀律） */
export async function GET() {
  return jsonMethodNotAllowed();
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
