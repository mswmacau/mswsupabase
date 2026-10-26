/**
 * src/lib/supabase/admin.ts — service_role 客戶端（繞過 RLS）
 *
 * ⚠️ 只在 server 端使用：只能被 Route Handler（src/app/api/**）或
 *    Server Component / Server Action import。
 *    **絕對不可被 "use client" 的元件 import**，也不可把本 client、
 *    金鑰或它的回傳值送到瀏覽器。
 *
 * 為什麼需要它：
 *   - auth.admin.createUser / deleteUser 只有 service_role 能做，
 *     anon key 完全做不到（會回 401 / 403）。
 *   - 本站正式環境「只」配置 anon key，因此本檔一律以
 *     isServiceRoleConfigured 判斷是否可用；沒設定時呼叫端必須明確
 *     回 501 SERVICE_ROLE_REQUIRED 或走軟刪除，不可假裝成功。
 *
 * 注意金鑰名稱是 SUPABASE_SERVICE_ROLE_KEY（不是 NEXT_PUBLIC_ 開頭）；
 * 一旦加上 NEXT_PUBLIC_ 前綴，Next.js 會把金鑰打包進前端 bundle。
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/env";

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * 是否已配置 service_role 金鑰。
 * 未配置時所有「需要管理 auth 使用者」的功能都必須降級（501 / 軟刪除）。
 */
export const isServiceRoleConfigured =
  SUPABASE_URL.startsWith("http") && SERVICE_ROLE_KEY.length > 20;

/**
 * 建立 service_role 客戶端（繞過 RLS，能操作 auth.users）。
 *
 * 這個 client 不保存 session、不自動 refresh：每次請求都應該是短命的，
 * 不應該把登入狀態帶進伺服器端共用實例。
 *
 * @throws 未設定 SUPABASE_SERVICE_ROLE_KEY 時拋出，呼叫端應先檢查
 *         isServiceRoleConfigured，不要直接呼叫後才接例外。
 */
export function createAdminClient(): SupabaseClient {
  if (!isServiceRoleConfigured) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY 未設定，無法建立 service_role 客戶端。"
    );
  }

  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
