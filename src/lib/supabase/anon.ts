/**
 * src/lib/supabase/anon.ts — 不含 cookie 的純匿名讀取客戶端
 *
 * Owner：白客。用途：getSiteTheme() 這類「同一份資料給所有人看」的查詢，
 * 避免用到 cookies（會讓呼叫它的 Route/Server Component 被迫轉為動態），
 * 也不會跟 unstable_cache 的序列化要求打架。
 *
 * 注意：它是 anon 角色，受 RLS 限制，只能讀取公開資料；
 *       任何寫入都不要用這個客戶端。
 */

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "./env";

let cached: SupabaseClient | null = null;

/** 未設定 env 時回傳 null（與 server.ts 行為一致） */
export function anonClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;

  cached ??= createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cached;
}
