import "server-only";

import { getMyAdminAccess } from "@/lib/queries";
import type { AdminAccess, AdminModule } from "@/components/adminModules";

/**
 * src/app/admin/_components/adminAccess.ts — 目前登入管理員的模組權限
 *
 * 【這是臨時轉接層】
 * 契約是 `getMyAdminAccess()`（白客在 src/lib/queries.ts，回 13 模組的
 * Record<'full'|'read'|'none'>）。那一支尚未落地，UI 不能等，所以本檔先自行解析；
 * 函式上線後把 getAdminAccess() 的 body 換成 `return getMyAdminAccess()` 即可，
 * 呼叫端（layout、各頁面）一行都不用改。
 *
 * 【判斷順序是安全關鍵，不要改順序】
 *   ① 查詢報錯 42703（欄位不存在 = migration 未跑）→ 全 full
 *      **只有這一種情況**給全開：那種世界本來就只有站主一個管理員，
 *      鎖死等於讓站主連自己的後台都進不去。
 *   ② admin_level === 1                        → 全 full（第一級）
 *   ③ admin_level === 2                        → 第二級表
 *   ④ admin_level === null 且 role === 'admin'  → 當第二級（fail closed）
 *      白客的 admin_module_access 對「未分級 admin」也回最窄權限；
 *      若這裡放成 full，一個未分級的管理員就會看到全部模組——真實提權洞。
 *   ⑤ 其他（role 不是 admin／查詢失敗／未登入）  → 全 none
 *
 * 【為什麼自己查、不用 getCurrentProfile()】
 * getCurrentProfile() 是 `select("*")`：**欄位不存在**與**值為 null** 在它
 * 回來的物件上長得一樣（都沒有值），而本檔必須分辨「42703 = migration 未跑」
 * 與「合法 null = 未分級 admin」——這兩者一個要全開、一個要收窄。
 * 所以這裡明確 `.select("role,admin_level")` 並直接讀 error.code。
 */
export async function getAdminAccess(): Promise<AdminAccess> {
  /*
   * 白客的 getMyAdminAccess() 已落地（commit b2ce651）：一次 RPC admin_my_access
   * 回 13 個模組；RPC 不存在（migration 未跑）時他自己 fallback 成
   * 「admin 全 full、其他人全 none」，正是我們要的降級語意。
   * 所以本檔縮成一行委派 —— 保留這一層的意義是：
   *   · 之後若還要換來源，只改這裡，layout 與 4 個拒訪頁不用動
   *   · 讓 admin 目錄不必各自 import lib/queries（依賴方向單一）
   */
  return getMyAdminAccess();
}

/** 單一模組的權限（頁面只需要自己那一格時用） */
export async function getMyAccessFor(
  mod: AdminModule
): Promise<"full" | "read" | "none"> {
  const access = await getAdminAccess();
  return access[mod];
}
