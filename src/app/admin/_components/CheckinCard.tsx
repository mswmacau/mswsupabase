import { CheckinReviewActions } from "@/components/ReviewActions";
import { formatDateTime, weekdayLabel } from "@/lib/utils";
import type { TrainingCheckin } from "@/lib/types";

/**
 * 一筆待確認簽到的卡片。
 *
 * IA 第二階段：/admin/checkins 與 /admin/review?tab=checkins 共用
 * （原本 JSX 寫死在 checkins/page.tsx 內）。樣式與行為原封不動。
 *
 * 390 的處理：`flex-wrap` + 姓名區 `min-w-[180px] flex-1`
 * —— 日期方塊 `shrink-0`，姓名區可壓縮並換行到按鈕下方，不會橫向溢出。
 * 「場次資料遺失」是既有防禦：session 被刪時顯示可讀文字而不是 undefined。
 */
export function CheckinCard({ checkin: c }: { checkin: TrainingCheckin }) {
  return (
    <div className="card-dark flex flex-wrap items-center gap-4 p-5">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-cobalt/20 text-sm font-bold">
        {new Date(c.session?.session_date ?? "").getDate() || "—"}
      </div>

      <div className="min-w-[180px] flex-1">
        <div className="font-semibold">
          {c.profile?.display_name ?? "（未具名會員）"}
        </div>
        <div className="mt-0.5 text-xs text-white/70">
          {c.session?.session_date
            ? `${c.session.session_date}（週${weekdayLabel(c.session.session_date)}）`
            : "場次資料遺失"}{" "}
          · {c.session?.title ?? ""} · {c.session?.location ?? ""}
        </div>
        <div className="mt-0.5 text-xs text-white/60">
          簽到時間 {formatDateTime(c.created_at)}
        </div>
      </div>

      <CheckinReviewActions checkinId={c.id} />
    </div>
  );
}
