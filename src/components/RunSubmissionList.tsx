import { StatusBadge } from "./StatusBadge";
import { formatDate, formatKm } from "@/lib/utils";
import type { RunSubmission } from "@/lib/types";

export function RunSubmissionList({
  items,
  emptyText = "尚無提交紀錄。",
}: {
  items: RunSubmission[];
  emptyText?: string;
}) {
  if (!items.length) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 px-4 py-10 text-center text-sm text-white/45">
        {emptyText}
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((s) => (
        <li
          key={s.id}
          className="flex flex-wrap items-center gap-4 rounded-xl border border-ink-line bg-black/20 p-4"
        >
          {s.image_url ? (
            <a
              href={s.image_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-ink-line"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.image_url}
                alt="跑步截圖"
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            </a>
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-ink-line bg-white/5 text-lg">
              🏃
            </div>
          )}

          <div className="min-w-[140px] flex-1">
            <div className="font-semibold">
              {formatKm(s.km)} <span className="text-xs text-white/45">km</span>
            </div>
            <div className="mt-0.5 text-xs text-white/45">
              {s.period_month} · {formatDate(s.created_at)}
            </div>
            {s.note && (
              <div className="mt-1 truncate text-xs text-white/55">{s.note}</div>
            )}
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <StatusBadge status={s.status} />
            {s.admin_note && (
              <span className="max-w-[200px] text-right text-xs text-white/50">
                管理員：{s.admin_note}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
