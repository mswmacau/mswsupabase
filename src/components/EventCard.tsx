/**
 * src/components/EventCard.tsx — 前台活動卡
 *
 * Owner：方砚。對齊 SPEC-R6.md FE-14：
 *  - 封面 16:9、日期徽章（含星期）、地點、名額、報名按鈕
 *  - 報名連結開新分頁並帶 rel="noopener noreferrer"
 *  - 報名連結為空時改顯示報名方式文字，不渲染空連結
 *  - 封面 loading="lazy"、decoding="async"、明確寬高比（aspect-[16/9]）防 CLS
 */

import { CalendarDays, MapPin, Ticket, Users } from "lucide-react";
import type { Event } from "@/lib/types";
import { publicAssetUrl } from "@/lib/assets";
import { formatDate, weekdayLabel } from "@/lib/utils";

function dateLabel(e: Event): string {
  const start = formatDate(e.event_date);
  if (e.end_date && e.end_date !== e.event_date) {
    return `${start} – ${formatDate(e.end_date)}`;
  }
  return `${start}（週${weekdayLabel(e.event_date)}）`;
}

export function EventCard({ event }: { event: Event }) {
  const cover = publicAssetUrl(event.cover_path);

  return (
    <article className="card-dark group flex flex-col overflow-hidden">
      <div className="relative aspect-[16/9] overflow-hidden border-b border-ink-line bg-gradient-to-br from-cobalt/40 via-ink-soft to-ink">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={event.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="hero-grid absolute inset-0 opacity-40" />
        )}
        <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-vital px-3 py-1 text-xs font-bold">
          <CalendarDays size={13} /> {dateLabel(event)}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-6">
        <h2 className="text-xl font-bold leading-snug">{event.title}</h2>
        {event.subtitle && (
          <p className="mt-2 text-sm text-white/60">{event.subtitle}</p>
        )}
        {event.body && (
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-white/55">
            {event.body}
          </p>
        )}

        <div className="mt-4 space-y-2 text-sm text-white/65">
          {event.location && (
            <div className="flex items-center gap-2">
              <MapPin size={15} className="shrink-0 text-vital" />
              {event.location}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Users size={15} className="shrink-0 text-vital" />
            {event.capacity
              ? `名額 ${event.capacity} 人`
              : "名額不限"}
          </div>
          {(event.start_time || event.end_time) && (
            <div className="flex items-center gap-2">
              <CalendarDays size={15} className="shrink-0 text-vital" />
              {[event.start_time, event.end_time].filter(Boolean).join(" – ")}
            </div>
          )}
        </div>

        <div className="mt-5 pt-1">
          {event.registration_url ? (
            <a
              href={event.registration_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-base btn-cobalt w-full text-sm"
            >
              <Ticket size={16} /> 報名 / 詳情
            </a>
          ) : event.registration_note ? (
            <div className="rounded-xl border border-ink-line bg-black/20 px-4 py-3 text-sm leading-relaxed text-white/70">
              <span className="mb-1 flex items-center gap-1.5 font-semibold text-white/85">
                <Ticket size={14} className="text-vital" /> 報名方式
              </span>
              {event.registration_note}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
