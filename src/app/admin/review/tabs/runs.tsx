import Link from "next/link";
import { getSubmissionsByStatus } from "@/lib/queries";
import { RunReviewCard } from "../../_components/RunReviewCard";

/**
 * /admin/review?tab=runs — 待審核中心的「跑步」分頁（Server Component）
 *
 * 只列 pending：這一頁的定位是「今天有什麼等我按」，歷史紀錄留在
 * `/admin/runs`（已確認／已駁回兩個狀態）。
 *
 * 重用：卡片是 `RunReviewCard`（與 /admin/runs 同一支），審核動作是
 * `RunReviewActions` → `/api/admin/review-run`。**沒有任何新的審核邏輯**，
 * 通過後照樣由後端累加里程、每公里 +1 積分、滿 300km +200 分並發券。
 */
export default async function RunsTab() {
  const items = await getSubmissionsByStatus("pending", 100);

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-white/70">
          通過後系統會自動累加里程、每公里 +1 積分；該月滿 300 公里再加 200 分並發券。
        </p>
        <p className="shrink-0 text-xs text-white/60">待確認 {items.length} 筆</p>
      </div>

      {items.length ? (
        <div className="space-y-4">
          {items.map((s) => (
            <RunReviewCard key={s.id} submission={s} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/15 px-4 py-14 text-center">
          <p className="text-sm font-semibold text-white/75">目前沒有待確認的跑步紀錄</p>
          <p className="mt-1 text-xs text-white/50">會員提交截圖後會出現在這裡。</p>
        </div>
      )}

      <p className="text-xs text-white/50">
        看已確認／已駁回的歷史：
        <Link
          href="/admin/runs"
          className="ml-1 font-semibold text-white/80 underline underline-offset-2 hover:text-white"
        >
          跑步紀錄（完整狀態）
        </Link>
      </p>
    </div>
  );
}
