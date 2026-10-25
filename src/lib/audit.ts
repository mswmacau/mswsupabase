/**
 * src/lib/audit.ts — 管理員操作日誌寫入（T-15）
 *
 * Owner：白客（backend-engineer）；前端不直接 import 本檔。
 * 契約：計劃 V2 §7.2 admin_audit_log（表結構與 RLS 見
 *       supabase/migration-audit-log.sql）；驗收標準 V1 O5 / V2 D6。
 *
 * 【取捨（如實註記）】日誌失敗不阻斷主流程：
 * 寫入點在管理員路由的主寫入成功之後呼叫本函式；本函式自身包 try/catch，
 * 失敗只寫 server log（console.warn），HTTP 回應與已完成的 DB 寫入不受影響。
 * 理由：操作日誌屬「事後稽核」屬性，不應讓管理員儲存內容因為日誌表暫時故障
 * 而失敗；代價是極少數情況下日誌會缺一筆——server log 留有同一筆錯誤，
 * 必要時可據此手動補記。
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 寫一筆管理員操作日誌（best-effort，永不拋出）。
 *
 * @param supabase 已通過 authorizeAdmin 的客戶端（RLS 的 audit_admin_insert
 *                 政策要求 with check is_admin()，呼叫端必須是授權管理員）
 * @param actorId  授權管理員的 user.id
 * @param module   模組名（路由名），如 "site-content"（表檢查 ≤40 字）
 * @param action   動作，如 "save" / "restore" / "publish"（≤20 字）
 * @param summary  一句中文人话摘要，如「更新首頁文案」（≤500 字）
 */
export async function writeAuditLog(
  supabase: SupabaseClient,
  actorId: string,
  module: string,
  action: string,
  summary: string
): Promise<void> {
  try {
    const { error } = await supabase.from("admin_audit_log").insert({
      actor_id: actorId,
      module,
      action,
      summary,
    });
    if (error) {
      // 只記錄、不拋出：日誌失敗不得影響管理員的主流程（見檔頭取捨）
      console.warn(
        `[audit] ${module}/${action} 寫入失敗（不影響主流程）：`,
        error.message
      );
    }
  } catch (err) {
    console.warn(`[audit] ${module}/${action} 寫入例外（不影響主流程）：`, err);
  }
}
