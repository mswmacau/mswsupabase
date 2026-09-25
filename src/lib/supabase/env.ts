export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * 尚未填入 .env.local 時為 false。
 * 所有 Supabase 客戶端會回傳 null，頁面走「未連接」空狀態，
 * 這樣在還沒註冊 Supabase 前也能先把網站跑起來看版型。
 */
export const isSupabaseConfigured =
  SUPABASE_URL.startsWith("http") && SUPABASE_ANON_KEY.length > 20;
