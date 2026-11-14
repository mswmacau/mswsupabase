import { getPendingCheckins } from "@/lib/queries";
import { CheckinCard } from "../../_components/CheckinCard";
import { RULES } from "@/lib/config";

/**
 * /admin/review?tab=checkins — 待審核中心的「簽到」分頁（Server Component）
 *
 * 重用：卡片 `CheckinCard`（與 /admin/checkins 同一支），動作
 * `CheckinReviewActions` → `/api/admin/review-checkin`（+RULES.CHECKIN_POINTS）。
 * 沒有新邏輯。
 */
export default async function CheckinsTab() {
  const items = await getPendingCheckins();

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-white/70">
          確認後會員立即獲得 {RULES.CHECKIN_POINTS} 積分，駁回則不發分。
        </p>
        <p className="shrink-0 text-xs text-white/60">待確認 {items.length} 筆</p>
      </div>

      {items.length ? (
        <div className="space-y-3">
          {items.map((c) => (
            <CheckinCard key={c.id} checkin={c} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/15 px-4 py-14 text-center">
          <p className="text-sm font-semibold text-white/75">目前沒有待確認的簽到</p>
          <p className="mt-1 text-xs text-white/50">
            會員在班表報名並現場簽到後，會出現在這裡。
          </p>
        </div>
      )}
    </div>
  );
}
