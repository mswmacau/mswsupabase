import Link from "next/link";
import { getSubmissionsByStatus } from "@/lib/queries";
import { RunReviewCard } from "../_components/RunReviewCard";
import { MovedNotice } from "../_components/MovedNotice";

export const metadata = { title: "跑步審核" };
export const dynamic = "force-dynamic";

/**
 * /admin/runs — 跑步里程審核（三個狀態分頁）
 *
 * 【IA 第二階段 20261114】每天要按的「通過／駁回」已集中到
 * `/admin/review?tab=runs`（與簽到／兌換／HYROX 付款同一頁四個分頁）。
 * 本路由**保留**（可能有人 bookmark，也還看得到已確認／已駁回的歷史），
 * 只在頂部放一條導引橫幅。
 *
 * 卡片 JSX 已抽到 `../_components/RunReviewCard`，與待審核中心共用同一份，
 * 避免兩個入口各寫一份、日後不同步。查詢與狀態篩選行為完全沒變。
 */

const TABS = [
  { key: "pending", label: "待確認" },
  { key: "approved", label: "已確認" },
  { key: "rejected", label: "已駁回" },
] as const;

export default async function AdminRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = (["pending", "approved", "rejected"].includes(status ?? "")
    ? status
    : "pending") as "pending" | "approved" | "rejected";

  const items = await getSubmissionsByStatus(active, 100);

  return (
    <div>
      <div className="mb-6">
        <MovedNotice
          title="跑步紀錄已整合到「待審核」"
          href="/admin/review?tab=runs"
          ctaLabel="去待審核中心"
        >
          待確認的提交現在和簽到、兌換、HYROX 付款放在同一頁，一天按一次就好。
          這一頁仍保留三個狀態的完整紀錄。
        </MovedNotice>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-bold">跑步里程審核</h2>
        <div className="flex gap-2">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/admin/runs?status=${t.key}`}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                active === t.key
                  ? "border-vital bg-vital text-white"
                  : "border-white/15 text-white/75 hover:border-white/40 hover:text-white"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      <p className="mt-2 text-sm text-white/70">
        通過後系統會自動：累加會員總里程 → 每公里 +1 積分 →
        檢查該月是否滿 300 公里，達標則額外 +200 分並自動發放優惠券。
      </p>

      <div className="mt-6 space-y-4">
        {items.length ? (
          items.map((s) => <RunReviewCard key={s.id} submission={s} />)
        ) : (
          <div className="rounded-xl border border-dashed border-white/15 px-4 py-14 text-center text-sm text-white/70">
            沒有{active === "pending" ? "待確認" : active === "approved" ? "已確認" : "已駁回"}的提交。
          </div>
        )}
      </div>
    </div>
  );
}
