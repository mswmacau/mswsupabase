"use client";

import { useRef, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CalendarDays,
  Clock,
  MapPin,
  Ticket,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { feeLabel } from "@/components/hyrox/shared";
import { usePanelOverlay } from "./use-panel-overlay";
import {
  PAID_HEX,
  colorHex,
  formatDayLong,
  statusText,
  type ScheduleSessionView,
} from "./schedule-utils";

/**
 * 場次詳情面板。
 *  - 桌面：右側滑出，430px，左側只留一層極淡遮罩，不遮住整個日曆
 *  - 手機：底部彈層（最大 85vh，內部可捲動）
 *  - 已取消：只顯示「這堂已取消」，不給 CTA（避免把人帶去報名一個取消的場次）
 */
export function SessionDetailPanel({
  session,
  onClose,
}: {
  session: ScheduleSessionView | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  usePanelOverlay(Boolean(session), panelRef, onClose);

  if (!session) return null;

  const accent = session.paid ? PAID_HEX : colorHex(session.colorKey);
  const cancelled = session.status === "cancelled";
  const titleId = `schedule-detail-${session.id}`;

  const timeText = session.startTime
    ? session.endTime
      ? `${session.startTime} – ${session.endTime}`
      : session.startTime
    : "時間待定";

  const statusClass = cancelled
    ? "border-white/20 bg-white/5 text-white/60"
    : session.status === "closed"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";

  return (
    <div className="fixed inset-0 z-[70]">
      {/* 遮罩：手機才需要壓暗背景；桌面只做極淡的一層，日曆仍看得見 */}
      <button
        type="button"
        aria-label="關閉詳情"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-ink/70 md:bg-ink/10"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-white/15 bg-ink-soft p-5 pb-8 shadow-[0_-24px_60px_-30px_rgba(0,0,0,0.9)] md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[430px] md:rounded-none md:border-l md:border-t-0 md:px-7 md:py-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-3 w-3 shrink-0 rotate-45"
                style={{ backgroundColor: accent }}
              />
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">
                {session.paid ? "付費場次" : "班表堂次"}
              </span>
            </div>
            <h2
              id={titleId}
              className="mt-3 text-xl font-black leading-tight tracking-tight text-white md:text-2xl"
            >
              {session.title}
            </h2>
          </div>

          <button
            type="button"
            data-autofocus
            onClick={onClose}
            aria-label="關閉"
            className="-mr-1 -mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center border border-white/15 bg-white/5 text-white/70 transition hover:border-white/30 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center border px-2 py-0.5 text-[11px] font-semibold ${statusClass}`}
          >
            {statusText(session.status)}
          </span>
          {session.paid && (
            <span
              className="inline-flex items-center border px-2 py-0.5 text-[11px] font-semibold"
              style={{
                color: PAID_HEX,
                borderColor: `color-mix(in srgb, ${PAID_HEX} 45%, transparent)`,
                backgroundColor: `color-mix(in srgb, ${PAID_HEX} 12%, transparent)`,
              }}
            >
              需付費
            </span>
          )}
        </div>

        <dl className="mt-6 border-t border-white/10">
          <DetailRow icon={<CalendarDays size={15} />} label="日期">
            {formatDayLong(session.date)}
          </DetailRow>
          <DetailRow icon={<Clock size={15} />} label="時間">
            {timeText}
          </DetailRow>
          <DetailRow icon={<UserRound size={15} />} label="教練">
            {session.coachName ?? "教練待定"}
          </DetailRow>
          <DetailRow icon={<MapPin size={15} />} label="場地">
            {session.location ?? "場地待定"}
          </DetailRow>
          <DetailRow icon={<Users size={15} />} label="名額">
            {session.capacity === null ? "不限" : `${session.capacity} 人`}
          </DetailRow>
          {session.paid && (
            <DetailRow icon={<Ticket size={15} />} label="費用">
              {feeLabel(session.feeCents)}
            </DetailRow>
          )}
        </dl>

        {cancelled ? (
          <div className="mt-7 flex items-start gap-3 border border-white/15 bg-white/[0.04] p-4">
            <span className="mt-0.5 shrink-0 text-white/50">
              <AlertCircle size={16} />
            </span>
            <div>
              <p className="text-sm font-semibold text-white">這堂已取消</p>
              <p className="mt-1 text-xs leading-relaxed text-white/60">
                館方已取消這個時段，請參考同週其他場次。
              </p>
            </div>
          </div>
        ) : session.cta ? (
          <Link
            href={session.cta.href}
            className={`btn-base btn-slab mt-7 w-full ${
              session.paid ? "btn-vital" : "btn-cobalt"
            }`}
          >
            {session.cta.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-white/10 py-3">
      <dt className="flex w-[4.5rem] shrink-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
        <span aria-hidden className="text-white/35">
          {icon}
        </span>
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm leading-relaxed break-words text-white/85">
        {children}
      </dd>
    </div>
  );
}
