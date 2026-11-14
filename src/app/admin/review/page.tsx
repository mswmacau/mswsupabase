import { SectionTabNav } from "../_components/SectionTabNav";
import { getAdminTodoCounts } from "@/lib/queries";
import RunsTab from "./tabs/runs";
import CheckinsTab from "./tabs/checkins";
import RedemptionsTab from "./tabs/redemptions";
import HyroxTab from "./tabs/hyrox";

export const metadata = { title: "待審核" };
export const dynamic = "force-dynamic";

/**
 * /admin/review — 待審核中心（IA 第二階段）
 *
 * 為什麼要做這一頁：四個入口（跑步 `/admin/runs`、簽到 `/admin/checkins`、
 * 兌換 `/admin/redemptions?status=pending_approval`、HYROX 付款 `/admin/hyrox`）
 * 分散在側欄三個不同分組裡，管理員每天要點四次才能回答同一個問題——
 * 「今天有什麼等我按」。現在一頁四個分頁，標題旁直接寫待處理筆數。
 *
 * 四條設計紀律：
 *  1. **重用，不重寫**：每個分頁都用原本那支元件與原本的 API。審核邏輯
 *     （批准／拒絕／加分／退分／回庫存）行為零改動，只搬位置。
 *  2. **只讀一次**：`getAdminTodoCounts()` 一次查四個數字給分頁標籤，
 *     資料列由各分頁自己取（只渲染當前分頁 → 一次只有一支查詢）。
 *  3. **失敗顯示「—」**：任何一個數字查不到就顯示破折號，**不顯示 0**。
 *     把失敗畫成 0，等於告訴管理員「今天沒事」，比留白更危險。
 *  4. **舊路由不刪**：四個舊頁都保留並在頂部放導引橫幅（可能有人 bookmark）。
 *
 * 分頁用整頁導覽（URL `?tab=`）而不是 client state：
 *  - 可分享、可書籤、上一頁可用；
 *  - 每次切換只渲染當前分頁，不會一次開四支查詢；
 *  - 對話框（拒絕原因等）掛在各自的 client component 內，切分頁即卸載，
 *    不會殘留半開的 modal。
 */
const TAB_KEYS = ["runs", "checkins", "redemptions", "hyrox"] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default async function AdminReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active: TabKey = (TAB_KEYS as readonly string[]).includes(tab ?? "")
    ? (tab as TabKey)
    : "runs";

  const todos = await getAdminTodoCounts();
  const values = [
    todos.pendingRuns,
    todos.pendingCheckins,
    todos.pendingRedemptions,
    todos.pendingHyroxPayments,
  ];
  const total = values.every((v) => v !== null)
    ? (values as number[]).reduce((sum, v) => sum + v, 0)
    : null;

  return (
    <div className="min-w-0 space-y-5">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-xl font-bold">待審核中心</h2>
          <p className="text-xs text-white/60">
            {total === null
              ? "件數暫時無法確認"
              : total === 0
                ? "共 0 件 · 目前沒有待處理事項"
                : `共 ${total} 件待處理`}
          </p>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          跑步、簽到、兌換、HYROX 付款四個入口合成一頁。分頁標籤旁的數字是真實待處理筆數，
          按完就會更新。
        </p>
      </div>

      <SectionTabNav
        label="待審核分類"
        active={active}
        items={[
          { key: "runs", label: "跑步", href: "/admin/review?tab=runs", count: todos.pendingRuns },
          {
            key: "checkins",
            label: "簽到",
            href: "/admin/review?tab=checkins",
            count: todos.pendingCheckins,
          },
          {
            key: "redemptions",
            label: "兌換",
            href: "/admin/review?tab=redemptions",
            count: todos.pendingRedemptions,
          },
          {
            key: "hyrox",
            label: "HYROX 付款",
            href: "/admin/review?tab=hyrox",
            count: todos.pendingHyroxPayments,
          },
        ]}
      />

      {active === "runs" ? (
        <RunsTab />
      ) : active === "checkins" ? (
        <CheckinsTab />
      ) : active === "redemptions" ? (
        <RedemptionsTab />
      ) : (
        <HyroxTab />
      )}
    </div>
  );
}
