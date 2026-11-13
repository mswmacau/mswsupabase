"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CalendarDays,
  ChevronLeft,
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
  sessionPhase,
  statusBadgeClass,
  statusText,
  type ScheduleDay,
  type ScheduleSessionView,
} from "./schedule-utils";

/** 已取消的顏色條／色塊統一用灰，讓「這堂不辦了」一眼看得出來 */
const CANCELLED_HEX = "#6b7280";

/** 場次的代表色：已取消 → 灰；付費 → 橙；其餘依課程色票（與日曆格子一致） */
function sessionAccent(session: ScheduleSessionView): string {
  if (session.status === "cancelled") return CANCELLED_HEX;
  return session.paid ? PAID_HEX : colorHex(session.colorKey);
}

/**
 * 場次詳情面板（兩層：當日清單 → 單場詳情）。
 *
 * 為什麼是兩層：手機的月曆格子只放得下顏色短條，沒有課名可以點。
 * 所以手機是「點某一天 → 面板列出該日全部場次 → 點某一列 → 單場詳情」。
 * 桌面格子的 pill 夠寬，點 pill 直接開單場詳情（此時 `day` 為 null，不顯示返回）。
 *
 * - 桌面：右側滑出，430px，左側只留一層極淡遮罩，不遮住整個日曆
 * - 手機：底部彈層（最大 85vh，內部可捲動）
 * - 已取消：只顯示「這堂已取消」，不給 CTA（避免把人帶去報名一個取消的場次）
 */
export function SessionDetailPanel({
  day,
  session,
  todayISO,
  onSelectSession,
  onBack,
  onClose,
}: {
  /** 手機：某一天的場次清單 */
  day: ScheduleDay | null;
  /** 單場詳情（有值時優先於 day） */
  session: ScheduleSessionView | null;
  /** Asia/Macau 的今天（server 傳入），用來判斷「已結束／今天／可報名」 */
  todayISO: string;
  onSelectSession: (session: ScheduleSessionView) => void;
  /** 從單場詳情回到當日清單 */
  onBack: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  usePanelOverlay(Boolean(day || session), panelRef, onClose);

  /**
   * 目前顯示哪一層：單場詳情優先，其次當日清單。
   * 用成一個 discriminated union 而不是兩個可能為 null 的變數，
   * 才不會在 JSX 裡到處需要 null 檢查。
   */
  const layer:
    | { kind: "detail"; session: ScheduleSessionView; day: ScheduleDay | null }
    | { kind: "day"; day: ScheduleDay }
    | null = session
    ? { kind: "detail", session, day }
    : day
      ? { kind: "day", day }
      : null;

  const layerKey =
    layer === null
      ? ""
      : layer.kind === "detail"
        ? `session-${layer.session.id}`
        : `day-${layer.day.date}`;

  /* 兩層切換（當日清單 ⇄ 單場詳情）不會重開面板，usePanelOverlay 的
   * 「開啟時聚焦」因此不會重跑。少了這段，按下某一列之後焦點會掉到 body，
   * 鍵盤與讀屏使用者會瞬間失去位置。這裡把焦點移到新的標題上（標題帶
   * tabIndex=-1，可聚焦但不在 Tab 序列裡）。 */
  useEffect(() => {
    if (!layerKey) return;
    panelRef.current?.querySelector<HTMLElement>("[data-layer-focus]")?.focus();
  }, [layerKey]);

  if (!layer) return null;

  // 從當日清單進來的才有返回鍵；桌面直接點 pill 進來時 day 為 null
  const canGoBack = layer.kind === "detail" && layer.day !== null;

  const titleId =
    layer.kind === "detail"
      ? `schedule-detail-${layer.session.id}`
      : `schedule-day-${layer.day.date}`;

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
          {canGoBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="返回當日場次"
              className="-ml-1 -mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center border border-white/15 bg-white/5 text-white/70 transition hover:border-white/30 hover:text-white"
            >
              <ChevronLeft size={16} />
            </button>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {layer.kind === "detail" ? (
                <>
                  <span
                    aria-hidden
                    className="h-3 w-3 shrink-0 rotate-45"
                    style={{ backgroundColor: sessionAccent(layer.session) }}
                  />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">
                    {layer.session.paid ? "付費場次" : "班表堂次"}
                  </span>
                </>
              ) : (
                <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">
                  當日場次
                </span>
              )}
            </div>

            <h2
              id={titleId}
              data-layer-focus
              tabIndex={-1}
              className="mt-3 text-xl font-black leading-tight tracking-tight text-white outline-none md:text-2xl"
            >
              {layer.kind === "detail"
                ? layer.session.title
                : formatDayLong(layer.day.date)}
            </h2>

            {layer.kind === "day" && (
              <p className="mt-2 text-xs text-white/50">
                共 {layer.day.sessions.length} 個場次，點一列看詳情。
              </p>
            )}
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

        {layer.kind === "detail" ? (
          <SessionDetailBody session={layer.session} todayISO={todayISO} />
        ) : (
          <DaySessionList
            day={layer.day}
            todayISO={todayISO}
            onSelectSession={onSelectSession}
          />
        )}
      </div>
    </div>
  );
}

/* =============================================================
 * 第一層：當日場次清單
 * ============================================================= */

function DaySessionList({
  day,
  todayISO,
  onSelectSession,
}: {
  day: ScheduleDay;
  todayISO: string;
  onSelectSession: (session: ScheduleSessionView) => void;
}) {
  if (day.sessions.length === 0) {
    return (
      <p className="mt-6 border-t border-white/10 pt-6 text-sm text-white/55">
        這天沒有場次。
      </p>
    );
  }

  return (
    <ul className="mt-5 divide-y divide-white/10 border-t border-white/10">
      {day.sessions.map((session) => {
        const cancelled = session.status === "cancelled";
        const accent = sessionAccent(session);
        const phase = sessionPhase(session.date, todayISO);
        const time = session.startTime
          ? session.endTime
            ? `${session.startTime}–${session.endTime}`
            : session.startTime
          : "時間待定";

        return (
          <li key={`${session.kind}-${session.id}`}>
            <button
              type="button"
              onClick={() => onSelectSession(session)}
              aria-label={`${time} ${session.title}${
                session.paid ? "，付費場次" : ""
              }${cancelled ? "，已取消" : ""}，看詳情`}
              className="flex w-full min-w-0 items-start gap-3 py-3 text-left transition hover:bg-white/[0.06]"
            >
              <span
                aria-hidden
                className="mt-0.5 h-8 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: accent }}
              />

              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span
                    className={`shrink-0 text-xs font-semibold tabular-nums ${
                      cancelled ? "text-white/40 line-through" : "text-white/85"
                    }`}
                  >
                    {time}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-sm font-semibold ${
                      cancelled
                        ? "text-white/40 line-through"
                        : "text-white"
                    }`}
                  >
                    {session.title}
                  </span>
                  <span
                    className={`shrink-0 border px-1.5 py-0.5 text-[10px] font-semibold ${statusBadgeClass(
                      session.status,
                      phase
                    )}`}
                  >
                    {statusText(session.status, phase)}
                  </span>
                </span>

                <span
                  className={`mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${
                    cancelled ? "text-white/35" : "text-white/55"
                  }`}
                >
                  <span className="break-words">
                    教練 {session.coachName ?? "待定"}
                  </span>
                  <span className="break-words">
                    場地 {session.location ?? "待定"}
                  </span>
                  {session.paid && !cancelled && (
                    <span style={{ color: PAID_HEX }}>付費</span>
                  )}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* =============================================================
 * 第二層：單場詳情
 * ============================================================= */

function SessionDetailBody({
  session,
  todayISO,
}: {
  session: ScheduleSessionView;
  todayISO: string;
}) {
  const accent = sessionAccent(session);
  const cancelled = session.status === "cancelled";
  const phase = sessionPhase(session.date, todayISO);

  const timeText = session.startTime
    ? session.endTime
      ? `${session.startTime} – ${session.endTime}`
      : session.startTime
    : "時間待定";

  const statusClass = statusBadgeClass(session.status, phase);

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-[11px] font-semibold ${statusClass}`}
        >
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: accent }}
          />
          {statusText(session.status, phase)}
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
    </>
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
