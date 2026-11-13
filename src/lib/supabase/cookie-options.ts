import type { CookieOptions } from "@supabase/ssr";

/**
 * Supabase auth cookie 的安全屬性（全站單一來源）
 *
 * 【安全修復 2026-11-13】審計實測：登入後的 `sb-*-auth-token` cookie 沒有 Secure
 * 屬性，等於明文 HTTP 連線也會把 session token 送出去（中間人可以撈）。
 * 根因是 @supabase/ssr 的 DEFAULT_COOKIE_OPTIONS（path=/、sameSite=lax、
 * httpOnly=false、maxAge=400d）**不含 secure**，而本專案 4 個 cookie 寫入點
 * 都是直接把 supabase 給的 options 原樣轉給 Next 的 cookie API。
 *
 * 這裡集中定義一份「不可被覆寫」的安全屬性，4 個寫入點全部經過
 * withAuthCookieOptions() 包一層：
 *   1. src/lib/supabase/server.ts         （Server Component / Route Handler）
 *   2. src/proxy.ts                       （session refresh，實際最常寫 cookie 的地方）
 *   3. src/app/api/auth/logout/route.ts   （前端 fetch 登出）
 *   4. src/app/auth/signout/route.ts      （無 JS 備援登出）
 *
 * 為什麼要用 NODE_ENV 判斷而不是無條件 secure：
 * 本機 dev 是 http://localhost:3000，帶 Secure 的 cookie 會被瀏覽器直接丟棄，
 * 變成「登入成功但立刻掉登入」的假故障。正式環境（Vercel）一律 HTTPS，
 * NODE_ENV 由 next build / next start 保證為 "production"，所以條件成立。
 *
 * ⚠️ 刻意保留 httpOnly=false：@supabase/ssr 的瀏覽器端 client（createBrowserClient）
 * 需要讀取 session，改 true 會直接令前端讀不到登入狀態。本專案前端已用
 * NEXT_PUBLIC_ 的 anon key，session 由 Supabase 官方模式管理，維持官方預設。
 */
const SECURE_COOKIE_ATTRS: CookieOptions = {
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
};

/**
 * 把 supabase 傳來的 cookie options 疊上本專案的安全屬性。
 *
 * 順序很重要：安全屬性放後面，確保 supabase 或未來套件版本不會把
 * secure / sameSite / path 覆蓋回不安全的預設值。
 * maxAge / expires / domain / httpOnly 等其餘屬性原樣保留，
 * 這樣「清除 cookie」（maxAge: 0）與「寫入 cookie」兩種情境都不受影響。
 */
export function withAuthCookieOptions(options: CookieOptions = {}): CookieOptions {
  return { ...options, ...SECURE_COOKIE_ATTRS };
}
