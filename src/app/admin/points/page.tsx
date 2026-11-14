import { isServiceRoleConfigured } from "@/lib/supabase/admin";
import { SectionTabNav } from "../_components/SectionTabNav";
import { PointRulesForm } from "../point-rules/PointRulesForm";
import { loadPointRules } from "../point-rules/load";
import { MonthlyPanel, resolveMonth } from "../monthly/MonthlyPanel";
import { CouponsPanel } from "../coupons/CouponsPanel";

export const metadata = { title: "積分與發券" };
export const dynamic = "force-dynamic";

/**
 * /admin/points — 積分與發券（IA 第二階段：四個分頁合成一頁）
 *
 * 原本三個一級入口（積分 `/admin/point-rules`、月度名單 `/admin/monthly`、
 * 優惠券 `/admin/coupons`）講的是同一件事：**分數怎麼發、券怎麼發**。
 * 客戶要發一張券得先判斷「這算月度達標還是自由發券」，再猜該去哪一頁。
 *
 * 四個分頁（對齊方案文件 §3.2）：
 *   1. 積分規則   → `PointRulesForm mode="rules"`（11 個規則值 + 兌換開關）
 *   2. 補發獎勵   → `PointRulesForm mode="award"`（同一支元件的 `ManualAward`）
 *   3. 月度達標   → `MonthlyPanel`（達標名單 + 全體里程 + 補發）
 *   4. 優惠券     → `CouponsPanel`（核銷 + 手動發券 + 全部券）
 *
 * 為什麼 1 與 2 是同一個元件的兩個 mode，而不是拆成兩個檔案：
 * `PointRulesForm` 705 行，規則的 state／儲存 handler／送出路徑與補發共用同一份
 * 依賴（補發要知道目前規則值）。**只切換顯示哪一段**是零風險的搬位置；
 * 拆檔等於重寫，違反「審核與發放邏輯不可改動行為」。
 *
 * 分頁用 URL（`?tab=`）而不是 client state：可書籤、可分享、
 * 每次只渲染一個分頁 → 一次只有一支資料查詢。
 */
const TAB_KEYS = ["rules", "award", "monthly", "coupons"] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default async function AdminPointsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; m?: string }>;
}) {
  const params = await searchParams;
  const active: TabKey = (TAB_KEYS as readonly string[]).includes(params.tab ?? "")
    ? (params.tab as TabKey)
    : "rules";
  const month = resolveMonth(params.m);

  // 只有規則／補發兩個分頁需要規則值與會員下拉
  const needsRules = active === "rules" || active === "award";
  const rulesData = needsRules ? await loadPointRules() : null;

  return (
    <div className="min-w-0 space-y-5">
      <div>
        <h2 className="text-xl font-bold">積分與發券</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          分數怎麼發、券怎麼發，四個分頁講同一件事：規則數值、單筆補發、
          月度達標補發、優惠券核銷。
        </p>
      </div>

      <SectionTabNav
        label="積分與發券分類"
        active={active}
        items={[
          { key: "rules", label: "積分規則", href: "/admin/points?tab=rules" },
          { key: "award", label: "補發獎勵", href: "/admin/points?tab=award" },
          { key: "monthly", label: "月度達標", href: "/admin/points?tab=monthly" },
          { key: "coupons", label: "優惠券", href: "/admin/points?tab=coupons" },
        ]}
      />

      {/*
       * 規則／補發：載入失敗時顯示可讀提示，不要空白。
       * 數值查詢失敗 → 不渲染表單（避免把 0 當成「目前設定」讓管理員誤存）。
       */}
      {needsRules ? (
        rulesData?.loadError ? (
          <div
            role="alert"
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
          >
            {rulesData.notConfigured
              ? "尚未連接 Supabase，暫時無法讀取積分規則。"
              : "積分規則暫時讀不到，請稍後重新整理；若持續失敗請聯絡技術人員。"}
          </div>
        ) : rulesData ? (
          <>
            {active === "rules" ? (
              <p className="text-sm leading-relaxed text-white/70">
                調整各項自動加分的數值。數值只影響之後的發放，不會追溯改動已入帳的積分。
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-white/70">
                為個別會員補發一次性獎勵（生日／邀請／活動／打卡）。
                後端有防重複機制；若要直接更正積分餘額，請到「會員 → 調整積分（更正）」。
              </p>
            )}
            <PointRulesForm
              mode={active === "rules" ? "rules" : "award"}
              initialRules={rulesData.rules}
              initialEnabled={rulesData.enabled}
              initialMembers={rulesData.members}
              hasServiceRole={isServiceRoleConfigured}
            />
          </>
        ) : null
      ) : active === "monthly" ? (
        <MonthlyPanel month={month} />
      ) : (
        <CouponsPanel />
      )}
    </div>
  );
}
