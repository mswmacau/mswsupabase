import Link from "next/link";
import { ExternalLink, Ruler } from "lucide-react";
import { RunReviewActions } from "@/components/ReviewActions";
import { formatDateTime, formatKm } from "@/lib/utils";
import type { RunSubmission } from "@/lib/types";

/**
 * 一筆跑步里程提交的審核卡片。
 *
 * IA 第二階段：/admin/runs 與 /admin/review?tab=runs 現在共用這一支
 * （原本 JSX 寫死在 runs/page.tsx 內，兩個入口就得各寫一份，遲早不同步）。
 * JSX 與樣式是從 runs/page.tsx 原封不動搬過來的，行為零改動：
 *  - 截圖可點開原圖（無圖時整塊不可點，但仍顯示「圖片無法載入」）
 *  - 只在 status === "pending" 時渲染審核動作（通過／駁回由 ReviewActions 負責）
 *
 * P1-1：
 *  - 待審核卡片的「通過」現在要先過二次確認，確認框要講清楚會加多少 km 與多少分，
 *    所以 cards 需要 pointsPerKm（由 server 端讀 app_settings 傳下來）。
 *  - 已核准的卡片多一顆「更正里程」——核准後里程已寫進 profiles.total_km，
 *    誤按時只能從會員管理把它改回去（見 supabase/migration-member-km-correction.sql）。
 *
 * 390：截圖 `h-40 w-full`（整寬）→ sm 以上才變 160px 正方形縮圖。
 * 資訊欄 `min-w-[200px] flex-1`：flex 子元素需要 min-w 才能正常換行／省略。
 */
export function RunReviewCard({
  submission: s,
  pointsPerKm = 1,
}: {
  submission: RunSubmission;
  pointsPerKm?: number;
}) {
  return (
    <div className="card-dark p-5">
      <div className="flex flex-wrap gap-5">
        {/* 截圖 */}
        <a
          href={s.image_url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className={`group relative block h-40 w-full shrink-0 overflow-hidden rounded-xl border border-ink-line bg-black/40 sm:w-40 ${
            s.image_url ? "" : "pointer-events-none"
          }`}
        >
          {s.image_url ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.image_url}
                alt="跑步截圖"
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
              <span className="absolute bottom-2 right-2 rounded-lg bg-black/70 p-1.5 text-white/80">
                <ExternalLink size={13} />
              </span>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-white/70">
              圖片無法載入
            </div>
          )}
        </a>

        {/* 資訊 */}
        <div className="min-w-[200px] flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xl font-black text-blue-300">
              {formatKm(s.km)}
              <span className="ml-1 text-sm text-white/70">km</span>
            </span>
            <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-xs text-white/75">
              {s.period_month}
            </span>
          </div>

          <div className="mt-2 text-sm">
            <span className="font-semibold">
              {s.profile?.display_name ?? "（未具名會員）"}
            </span>
            <span className="ml-2 text-xs text-white/70">
              提交於 {formatDateTime(s.created_at)}
            </span>
          </div>

          {s.note && (
            <p className="mt-2 rounded-lg bg-black/30 px-3 py-2 text-xs text-white/75">
              會員備註：{s.note}
            </p>
          )}

          {s.admin_note && (
            <p className="mt-2 text-xs text-amber-300">管理員備註：{s.admin_note}</p>
          )}

          {s.status === "pending" && (
            <RunReviewActions
              submissionId={s.id}
              km={s.km}
              pointsPerKm={pointsPerKm}
            />
          )}

          {/* 已核准：里程已經加進會員的 total_km，誤按時只能從會員管理更正。
              掛一顆直達連結，省掉「記住名字 → 去會員頁 → 搜尋 → 開抽屜」四步。 */}
          {s.status === "approved" && (
            <div className="mt-3">
              <Link
                href={`/admin/members?member=${s.user_id}&action=correct-km`}
                data-testid="correct-km-link"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-white/20 px-3 text-xs font-semibold text-white/80 transition hover:border-white/45 hover:text-white md:min-h-0 md:py-1.5"
              >
                <Ruler size={13} /> 更正里程
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
