/**
 * src/components/EventCard.tsx — 前台活動卡
 *
 * Owner：方砚。對齊 SPEC-R6.md FE-14：
 *  - 封面 16:9、日期徽章（含星期）、地點、名額、報名按鈕
 *  - 報名連結開新分頁並帶 rel="noopener noreferrer"
 *  - 報名連結為空時改顯示報名方式文字，不渲染空連結
 *  - 封面 loading="lazy"、decoding="async"、明確寬高比（aspect-[16/9]）防 CLS
 *
 * 2026 視覺升級：髮絲描邊 + 斜切角、hover 景深抬升、斜切日期徽章、
 * 大寫寬字距標籤。顏色全部由 --color-* 變數衍生。
 */

import { CalendarDays, MapPin, Ticket, Users } from "lucide-react";
import type { Event } from "@/lib/types";
import { publicAssetUrl } from "@/lib/assets";
import { formatDate, weekdayLabel } from "@/lib/utils";

/**
 * 報名連結防呆：若 registration_url 指向本站自己（vercel 正式網域、
 * 當前 NEXT_PUBLIC_SITE_URL、localhost），就不渲染成連結——
 * 避免後台誤填自家網址時，訪客點「報名」又跳回同一頁的空循環
 * （2026-09 實測事故：DB 填了 https://msw-street-workout.vercel.app/events）。
 */
function isSelfUrl(raw: string): boolean {
  let host: string;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    host = u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false; // 非 URL 格式交由既有渲染邏輯處理
  }

  if (host === "msw-street-workout.vercel.app") return true;
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    return true;
  }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl) {
    try {
      const siteHost = new URL(siteUrl).hostname
        .toLowerCase()
        .replace(/^www\./, "");
      if (host === siteHost) return true;
    } catch {
      // env 格式異常時忽略，不影響其他判斷
    }
  }
  return false;
}

function dateLabel(e: Event): string {
  const start = formatDate(e.event_date);
  if (e.end_date && e.end_date !== e.event_date) {
    return `${start} – ${formatDate(e.end_date)}`;
  }
  return `${start}（週${weekdayLabel(e.event_date)}）`;
}

export function EventCard({ event }: { event: Event }) {
  const cover = publicAssetUrl(event.cover_path);
  // 報名連結指向本站時不渲染連結，一律走報名方式文字（無 note 給預設文案）
  const selfPointing = event.registration_url
    ? isSelfUrl(event.registration_url)
    : false;
  // 維持原行為：連結與 note 皆為空時整塊不渲染
  const showNote = selfPointing || Boolean(event.registration_note);

  return (
    // fx-weight-card：hover 時下沉＋斜向掃光（街健＝重量感，故意不用上浮）
    // 觸控裝置與 reduced-motion 會自動停用，見 globals.css
    <article className="group relative flex flex-col overflow-hidden border border-white/10 bg-ink-soft z-raise clip-notch-br fx-weight-card">
      <div className="relative aspect-[16/9] overflow-hidden border-b border-white/10 bg-gradient-to-br from-cobalt/40 via-ink-soft to-ink">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={event.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.04]"
          />
        ) : (
          <div className="hero-grid absolute inset-0 opacity-40 transition-opacity duration-500 group-hover:opacity-70" />
        )}
        {/* 底部漸層：與內文銜接，避免硬切 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink-soft to-transparent" />
        {/* 斜切日期徽章 */}
        <div className="slab absolute left-3 top-3 inline-flex items-center gap-1.5 border border-vital/50 bg-vital/90 px-3 py-1 text-[11px] font-bold tracking-[0.06em] text-white backdrop-blur-sm">
          <CalendarDays size={13} /> {dateLabel(event)}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-6">
        <h2 className="text-xl font-black leading-snug tracking-tight transition-colors duration-500 group-hover:text-vital-bright">
          {event.title}
        </h2>
        {event.subtitle && (
          <p className="mt-2 text-sm text-white/65">{event.subtitle}</p>
        )}
        {event.body && (
          <p className="mt-3 line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-white/70">
            {event.body}
          </p>
        )}

        <div className="mt-5 space-y-2 border-t border-white/10 pt-4 text-sm text-white/70">
          {event.location && (
            <div className="flex items-center gap-2">
              <MapPin size={15} className="shrink-0 text-vital-bright" />
              <span className="truncate">{event.location}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Users size={15} className="shrink-0 text-vital-bright" />
            {event.capacity ? `名額 ${event.capacity} 人` : "名額不限"}
          </div>
          {(event.start_time || event.end_time) && (
            <div className="flex items-center gap-2">
              <CalendarDays size={15} className="shrink-0 text-vital-bright" />
              {[event.start_time, event.end_time].filter(Boolean).join(" – ")}
            </div>
          )}
        </div>

        <div className="mt-auto pt-6">
          {event.registration_url && !selfPointing ? (
            <a
              href={event.registration_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-base btn-cobalt btn-slab w-full text-sm"
            >
              <Ticket size={16} /> 報名 / 詳情
            </a>
          ) : showNote ? (
            <div className="border-l-2 border-vital/60 bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-white/70">
              <span className="mb-1 flex items-center gap-1.5 font-semibold text-white/85">
                <Ticket size={14} className="text-vital-bright" /> 報名方式
              </span>
              {event.registration_note ?? "詳情請洽官方 Instagram"}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
