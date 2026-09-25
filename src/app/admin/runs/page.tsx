import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { getSubmissionsByStatus } from "@/lib/queries";
import { RunReviewActions } from "@/components/ReviewActions";
import { formatDateTime, formatKm } from "@/lib/utils";
import type { RunSubmission } from "@/lib/types";

export const metadata = { title: "跑步審核" };
export const dynamic = "force-dynamic";

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
                  : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      <p className="mt-2 text-sm text-white/50">
        通過後系統會自動：累加會員總里程 → 每公里 +1 積分 →
        檢查該月是否滿 300 公里，達標則額外 +200 分並自動發放優惠券。
      </p>

      <div className="mt-6 space-y-4">
        {items.length ? (
          items.map((s) => <ReviewCard key={s.id} submission={s} />)
        ) : (
          <div className="rounded-xl border border-dashed border-white/15 px-4 py-14 text-center text-sm text-white/45">
            沒有{active === "pending" ? "待確認" : active === "approved" ? "已確認" : "已駁回"}的提交。
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewCard({ submission: s }: { submission: RunSubmission }) {
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
            <div className="flex h-full items-center justify-center text-xs text-white/40">
              圖片無法載入
            </div>
          )}
        </a>

        {/* 資訊 */}
        <div className="min-w-[200px] flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xl font-black text-blue-300">
              {formatKm(s.km)}
              <span className="ml-1 text-sm text-white/45">km</span>
            </span>
            <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-xs text-white/55">
              {s.period_month}
            </span>
          </div>

          <div className="mt-2 text-sm">
            <span className="font-semibold">
              {s.profile?.display_name ?? "（未具名會員）"}
            </span>
            <span className="ml-2 text-xs text-white/40">
              提交於 {formatDateTime(s.created_at)}
            </span>
          </div>

          {s.note && (
            <p className="mt-2 rounded-lg bg-black/30 px-3 py-2 text-xs text-white/60">
              會員備註：{s.note}
            </p>
          )}

          {s.admin_note && (
            <p className="mt-2 text-xs text-amber-300">管理員備註：{s.admin_note}</p>
          )}

          {s.status === "pending" && <RunReviewActions submissionId={s.id} />}
        </div>
      </div>
    </div>
  );
}
