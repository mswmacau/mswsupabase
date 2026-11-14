import Link from "next/link";
import { Ruler } from "lucide-react";
import { getPointsPerKm, getSubmissionsByStatus } from "@/lib/queries";
import { formatKm } from "@/lib/utils";
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
 *
 * P1-1（誤按不可逆）：核准是立即寫入、無法用介面還原的操作，所以
 *  1. 卡片上的「通過」先跳二次確認，確認框要顯示「會加多少 km / 多少分」，
 *     因此這裡讀一次 `app_settings.points_per_km`（後台可調，不可寫死 1）往下傳。
 *  2. 已核准的紀錄旁邊要有「更正里程」入口 —— 這一頁只列 pending，
 *     按完就消失，所以補一小塊「最近已核准」，讓管理員按錯後不必繞去別頁找人。
 */
export default async function RunsTab() {
  const [items, recentlyApproved, pointsPerKm] = await Promise.all([
    getSubmissionsByStatus("pending", 100),
    getSubmissionsByStatus("approved", 5),
    getPointsPerKm(),
  ]);

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
            <RunReviewCard
              key={s.id}
              submission={s}
              pointsPerKm={pointsPerKm}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/15 px-4 py-14 text-center">
          <p className="text-sm font-semibold text-white/75">目前沒有待確認的跑步紀錄</p>
          <p className="mt-1 text-xs text-white/50">會員提交截圖後會出現在這裡。</p>
        </div>
      )}

      {/* ===== 最近已核准（可更正里程）=====
          誤按「通過」之後最自然的補救路徑就在這一頁：
          看到剛才按錯的那一筆 → 直接點「更正里程」到會員抽屜改回去。 */}
      <section aria-label="最近已核准的跑步紀錄" className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/45">
          最近已核准（可更正里程）
        </h3>
        {recentlyApproved.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/15 px-4 py-4 text-center text-xs text-white/50">
            尚無已核准紀錄。
          </p>
        ) : (
          <ul className="divide-y divide-ink-line rounded-xl border border-ink-line">
            {recentlyApproved.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {s.profile?.display_name ?? "（未具名會員）"}
                </span>
                <span className="shrink-0 tabular-nums text-white/75">
                  {formatKm(s.km)} km · {s.period_month}
                </span>
                <Link
                  href={`/admin/members?member=${s.user_id}&action=correct-km`}
                  data-testid="correct-km-link"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/20 px-3 text-xs font-semibold text-white/80 transition hover:border-white/45 hover:text-white min-h-11 md:min-h-0 md:py-1"
                >
                  <Ruler size={13} /> 更正里程
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

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
