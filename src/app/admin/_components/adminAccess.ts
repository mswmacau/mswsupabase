import "server-only";

import { getMyAdminAccess } from "@/lib/queries";
import type { AdminAccess, AdminModule } from "@/components/adminModules";

/**
 * src/app/admin/_components/adminAccess.ts — 目前登入管理員的模組權限
 *
 * 【薄轉接層：實作已在白客的 getMyAdminAccess()】
 * 真正的判斷在後端（migration-admin-levels.sql §4 的 admin_module_access）：
 *   · 非 admin                                    → 全部 none
 *   · admin_level = 1                             → 全部 full（第一級）
 *   · admin_level = 2                             → 對照表（7 full / 2 read / 4 none）
 *   · **role=admin 但 admin_level is null（未分級）→ 全部 none（fail closed）**
 *   · migration 未跑（RPC 不存在）                → admin 全 full、其他全 none
 *
 * ⚠️ 那個「null → none」很容易寫錯，我就在前端踩過一次：
 *   typeof null === "object"，所以 `typeof admin_level === "number"` 無法
 *   分辨「沒有欄位」與「值為 null」；而 UI 若把 null 顯示成「第一級」或
 *   「第二級」，管理員會看到有級別、實際卻什麼都點不進去。
 *   判定級別時請明確比對 `=== 1` / `=== 2`，其餘一律當「未分級」。
 *
 * 為什麼還要保留這一層：
 *   · 之後換來源只改這裡，layout 與 4 個拒訪頁一行都不用動
 *   · admin 目錄不必各自 import lib/queries（依賴方向單一）
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
