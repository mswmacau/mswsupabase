import { isServiceRoleConfigured } from "@/lib/supabase/admin";
import { MovedNotice } from "../_components/MovedNotice";
import { PointRulesForm } from "./PointRulesForm";
import { loadPointRules } from "./load";

export const metadata = { title: "積分規則" };
export const dynamic = "force-dynamic";

/**
 * /admin/point-rules — 積分規則與手動補發
 *
 * 【IA 第二階段 20261114】已整合到 `/admin/points`（規則／補發獎勵兩個分頁）。
 * 本路由**保留**（可能有人 bookmark），內容照常可用，頂部加導引橫幅。
 * 取數抽到 `./load`：合併頁與這頁共用同一份 11 個規則 key 清單。
 *
 * 規則值存 app_settings（key → jsonb number），會員已可讀，寫入受 RLS 限制為管理員。
 * 手動補發一律經 /api/admin/point-rules，由後端呼叫 award_* RPC（含防重複）。
 */
export default async function AdminPointRulesPage() {
  const { rules, enabled, members, loadError, notConfigured } = await loadPointRules();

  return (
    <div className="min-w-0 space-y-6">
      <MovedNotice
        title="積分規則已整合到「積分與發券」"
        href="/admin/points?tab=rules"
        ctaLabel="去積分與發券"
      >
        規則、補發獎勵、月度達標、優惠券現在是同一頁的四個分頁。這一頁仍可直接使用。
      </MovedNotice>

      <div>
        <h2 className="text-xl font-bold">積分規則</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          調整各項自動加分的數值，或手動為個別會員補發。數值只影響之後的發放，
          不會追溯改動已入帳的積分。
        </p>
      </div>

      {loadError ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {notConfigured
            ? "尚未連接 Supabase，暫時無法讀取積分規則。"
            : "積分規則暫時讀不到，請稍後重新整理；若持續失敗請聯絡技術人員。"}
        </div>
      ) : (
        <PointRulesForm
          initialRules={rules}
          initialEnabled={enabled}
          initialMembers={members}
          hasServiceRole={isServiceRoleConfigured}
        />
      )}
    </div>
  );
}
