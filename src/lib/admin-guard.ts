/**
 * src/lib/admin-guard.ts — 後台新 API 共用的「先驗管理員」步驟
 *
 * 與 src/app/api/admin/review-run/route.ts 完全同一套順序：
 *   未連接 Supabase → 400、未登入 → 401、非管理員 → 403。
 * 差別只在於把重複的五段樣板收斂成一個函式，回傳 supabase client 與 actorId
 * （actorId 給 admin_audit_log 用）。
 *
 * 刻意不回傳任何錯誤細節給瀏覽器；細節只寫 server log（見 src/lib/api.ts）。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  jsonForbidden,
  jsonNotConfigured,
  jsonUnauthenticated,
} from "@/lib/api";

export type AdminAuthResult =
  | { ok: true; supabase: SupabaseClient; actorId: string }
  | { ok: false; res: Response };

/* =============================================================
 * 兩級管理員：模組權限
 *
 * 契約：supabase/migration-admin-levels.sql §4 admin_module_access(text)
 *   非管理員／無級別 → 'none'；第一級 → 'full'；
 *   第二級按模組：members/rewards = 'read'，其餘白名單 = 'full'，
 *   analytics/content/theme/audit/未知 = 'none'
 *
 * 【降級是硬要求】
 * migration 未跑時 admin_module_access 不存在（PGRST202 / 42883），
 * 此時**一律 fallback 'full'**（＝舊行為：只要是 admin 就全開）。
 * 理由：程式碼先上線、SQL 後貼是常態；分級系統故障不可以把站主鎖在門外。
 * 反向的錯誤（把 none 誤判成 full）只在 SQL 未跑時發生，而那段時間
 * 本來就沒有任何分級資料，等於「分級未啟用」，可接受。
 * ============================================================= */

/**
 * 後台模組名（必須與 SQL 的 case 分支逐字一致）
 *
 * ⚠️ 新增／改變後台路由的模組歸屬時，**必須同一支 PR 同步更新兩個地方**：
 *    · src/app/admin/_components/adminModules.ts 的 PATH_MODULE（側欄與頁面 canView）
 *    · 本檔 authorizeModule / assertModuleAccess 的呼叫端（API 守衛）
 * 兩者不一致會出現「頁面看得到、按了 403」或反之。
 *
 * 這輪曾出現 3 次錯歸屬（point-rules / checkins / runs+sessions），全部靠
 * 「頁面實際打哪支 API × 該 API 的守衛模組」比對才發現 —— 單看頁面名稱看不出來
 * （/admin/checkins 聽起來像簽到管理，實際是 review 工作流；
 *   /admin/point-rules 聽起來像兌換，實際屬 points）。
 *
 * 反向提醒：有些頁面沒有對應 API（server component 直查 DB，例如 /admin/runs、
 * /admin/audit-log），那些頁面的模組守衛**只有 canView 一層**（RLS 只認 is_admin()），
 * 所以 PATH_MODULE 對它們是唯一防線，改動時要格外小心。
 */
export type AdminModule =
  | "analytics"
  | "schedule"
  | "events"
  | "members"
  | "review"
  | "points"
  | "rewards"
  | "commerce"
  | "content"
  | "slides"
  | "coaches"
  | "theme"
  | "audit";

/** 模組權限等級 */
export type ModuleAccess = "full" | "read" | "none";

/** 帶模組權限的授權結果（成功分支是 AdminAuthResult 成功分支的擴充） */
export type ModuleAuthResult =
  | ({
      ok: true;
      supabase: SupabaseClient;
      actorId: string;
    } & { access: ModuleAccess })
  | { ok: false; res: Response };

/** 函式不存在（migration 未跑）：42883 / PGRST202 */
function isFunctionMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "42883" || code === "PGRST202") return true;
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return /could not find the function|function .* does not exist/i.test(message);
}

/**
 * 查模組權限。任何異常（函式不存在、網路、形態不符）都 fallback 'full'，
 * 永不拋出、永不因為分級系統本身故障而擋住管理員。
 */
async function queryModuleAccess(
  supabase: SupabaseClient,
  module: AdminModule
): Promise<ModuleAccess> {
  try {
    const { data, error } = await supabase.rpc("admin_module_access", {
      p_module: module,
    });

    if (error) {
      if (!isFunctionMissing(error)) {
        // 分級系統本身的錯誤：記錄但不阻斷（fail open，理由見檔頭）
        console.warn(
          `[admin-guard] admin_module_access(${module}) 失敗，暫以舊行為放行：`,
          error.message
        );
      }
      return "full";
    }

    const value = String(data ?? "").trim().toLowerCase();
    if (value === "full" || value === "read" || value === "none") return value;

    // 回傳形態不符（理論上不會）→ 放行，避免把管理員鎖死
    return "full";
  } catch (err) {
    console.warn(`[admin-guard] admin_module_access(${module}) 例外，暫以舊行為放行：`, err);
    return "full";
  }
}

/**
 * 只做模組檢查（授權已由呼叫端自己的邏輯完成）。
 * 給那些「自己內聯 getUser + role 檢查」的舊路由用。
 *
 * @returns null = 放行；Response = 應直接回傳的 403
 */
export async function assertModuleAccess(
  supabase: SupabaseClient,
  module: AdminModule,
  opts: { write?: boolean } = {}
): Promise<Response | null> {
  const access = await queryModuleAccess(supabase, module);
  if (access === "none") return jsonForbidden();
  if (access === "read" && opts.write === true) return jsonForbidden();
  return null;
}

/**
 * 管理員 + 模組權限（兩級管理員的主要入口）。
 *
 * 順序與 authorizeAdmin 完全一致：未設定 400 → 未登入 401 → 非管理員 403，
 * 之後才查模組權限（'none' → 403；'read' 但要寫 → 403）。
 */
export async function authorizeModule(
  module: AdminModule,
  opts: { write?: boolean } = {}
): Promise<ModuleAuthResult> {
  const auth = await authorizeAdmin();
  if (!auth.ok) return auth;

  const access = await queryModuleAccess(auth.supabase, module);
  if (access === "none") return { ok: false, res: jsonForbidden() };
  if (access === "read" && opts.write === true) return { ok: false, res: jsonForbidden() };

  return { ok: true, supabase: auth.supabase, actorId: auth.actorId, access };
}

export async function authorizeAdmin(): Promise<AdminAuthResult> {
  if (!isSupabaseConfigured) return { ok: false, res: jsonNotConfigured() };

  const supabase = await createClient();
  if (!supabase) return { ok: false, res: jsonNotConfigured() };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, res: jsonUnauthenticated() };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") return { ok: false, res: jsonForbidden() };

  return { ok: true, supabase, actorId: user.id };
}
