"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SessionDetailPanel } from "./SessionDetailPanel";
import {
  PAID_HEX,
  WEEKDAY_LABELS,
  chunkWeeks,
  colorHex,
  formatDayShort,
  formatMonthTitle,
  formatWeekRange,
  isoWeekdayIndex,
  type ScheduleDay,
  type ScheduleSessionView,
} from "./schedule-utils";

/** 桌面每格最多顯示幾個 pill，其餘收成 +N */
const MAX_PILLS = 3;

/**
 * 班表日曆。
 *  桌面（≥768px）：月曆，週一起始 7 欄，格內最多 3 個 pill + 「+N」
 *  手機（<768px）：一次一週、7 天直向堆疊，上/下週箭頭，**不做橫向捲動**
 *
 * 場次資料（含 HYROX 付費場次）由 Server Component 攤平成 ScheduleSessionView 後傳入，
 * 這裡只管畫與互動，不碰資料庫、不做日期計算以外的業務判斷。
 */
export function ScheduleCalendar({
  year,
  month,
  days,
}: {
  year: number;
  month: number;
  days: ScheduleDay[];
}) {
  const [selected, setSelected] = useState<ScheduleSessionView | null>(null);

  const weeks = useMemo(() => chunkWeeks(days), [days]);

  // 預設週：含今天的那一週（只有當月才會有 isToday），否則第一週
  const initialWeekIndex = useMemo(() => {
    const index = weeks.findIndex((week) => week.some((day) => day.isToday));
    return index >= 0 ? index : 0;
  }, [weeks]);

  const [weekIndex, setWeekIndex] = useState(initialWeekIndex);
  const safeWeekIndex = Math.min(Math.max(weekIndex, 0), Math.max(weeks.length - 1, 0));
  const currentWeek = weeks[safeWeekIndex] ?? [];

  const hasAnySession = days.some((day) => day.inMonth && day.sessions.length > 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-black tracking-tight text-white md:text-xl">
          {formatMonthTitle(year, month)}班表
        </h3>
        <div className="flex items-center gap-4 text-[11px] text-white/50">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-[3px] bg-white/50" />
            班表堂次
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2 w-[3px]"
              style={{ backgroundColor: PAID_HEX }}
            />
            <span style={{ color: PAID_HEX }}>付費場次</span>
          </span>
        </div>
      </div>

      {!hasAnySession && (
        <p className="mt-4 border border-dashed border-white/15 bg-white/[0.02] px-4 py-3 text-sm text-white/60">
          本月暫無場次，班表更新後會出現在這裡。
        </p>
      )}

      {/* ================= 桌面：月曆 ================= */}
      <div className="mt-5 hidden md:block">
        <div
          className="grid grid-cols-7 border-l border-t border-white/10"
          aria-label={`${formatMonthTitle(year, month)}班表`}
        >
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="border-b border-r border-white/10 bg-white/[0.03] py-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45"
            >
              週{label}
            </div>
          ))}

          {days.map((day) => (
            <div
              key={day.date}
              className={`relative min-h-[126px] border-b border-r border-white/10 p-2 ${
                day.isToday
                  ? "bg-cobalt/[0.14] ring-1 ring-inset ring-cobalt-bright/60"
                  : day.inMonth
                    ? "bg-ink-soft/40"
                    : "bg-transparent"
              }`}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span
                  className={`text-[11px] font-bold tabular-nums ${
                    day.isToday
                      ? "text-vital-bright"
                      : day.inMonth
                        ? "text-white/70"
                        : "text-white/25"
                  }`}
                >
                  {Number(day.date.slice(8, 10))}
                </span>
                {day.isToday && (
                  <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-vital-bright">
                    今天
                  </span>
                )}
              </div>

              <div className="mt-1.5 min-w-0 space-y-1">
                {day.sessions.slice(0, MAX_PILLS).map((session) => (
                  <SessionPill
                    key={`${session.kind}-${session.id}`}
                    session={session}
                    onSelect={setSelected}
                  />
                ))}
                {day.sessions.length > MAX_PILLS && (
                  <div className="pl-1.5 text-[10px] font-semibold text-white/45">
                    +{day.sessions.length - MAX_PILLS}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ================= 手機：週檢視（無橫向捲動） ================= */}
      <div className="mt-5 md:hidden">
        <div className="flex items-center justify-between gap-2 border border-white/10 bg-white/[0.03] px-2 py-1.5">
          <button
            type="button"
            onClick={() => setWeekIndex(safeWeekIndex - 1)}
            disabled={safeWeekIndex <= 0}
            aria-label="上一週"
            className="inline-flex h-9 w-9 items-center justify-center border border-white/15 text-white/75 transition disabled:opacity-30"
          >
            <ChevronLeft size={16} />
          </button>

          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-sm font-semibold text-white">
              {formatWeekRange(currentWeek)}
            </div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">
              第 {safeWeekIndex + 1} / {weeks.length} 週
            </div>
          </div>

          <button
            type="button"
            onClick={() => setWeekIndex(safeWeekIndex + 1)}
            disabled={safeWeekIndex >= weeks.length - 1}
            aria-label="下一週"
            className="inline-flex h-9 w-9 items-center justify-center border border-white/15 text-white/75 transition disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <ul className="divide-y divide-white/10 border-x border-b border-white/10">
          {currentWeek.map((day) => (
            <li
              key={day.date}
              className={`flex items-start gap-3 px-3 py-2.5 ${
                day.isToday ? "bg-cobalt/[0.14]" : day.inMonth ? "" : "opacity-45"
              }`}
            >
              <div className="w-11 shrink-0 text-center">
                <div className="text-[10px] font-semibold tracking-[0.16em] text-white/40">
                  週{WEEKDAY_LABELS[isoWeekdayIndex(day.date)]}
                </div>
                <div
                  className={`text-base font-black tabular-nums ${
                    day.isToday ? "text-vital-bright" : "text-white/85"
                  }`}
                >
                  {Number(day.date.slice(8, 10))}
                </div>
              </div>

              <div className="min-w-0 flex-1 space-y-1">
                {day.sessions.length === 0 ? (
                  <span className="text-[11px] text-white/30">—</span>
                ) : (
                  day.sessions.map((session) => (
                    <SessionPill
                      key={`${session.kind}-${session.id}`}
                      session={session}
                      onSelect={setSelected}
                    />
                  ))
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <SessionDetailPanel session={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/**
 * 一個場次 pill：時間 + 課程名，左側顏色條依 class_color_key；
 * 付費場次整體轉橙並帶「付費」小標；已取消加刪除線並灰化（但仍可點開看原因）。
 */
function SessionPill({
  session,
  onSelect,
}: {
  session: ScheduleSessionView;
  onSelect: (session: ScheduleSessionView) => void;
}) {
  const cancelled = session.status === "cancelled";
  const accent = session.paid ? PAID_HEX : colorHex(session.colorKey);
  const time = session.startTime ?? "待定";

  return (
    <button
      type="button"
      onClick={() => onSelect(session)}
      aria-label={`${formatDayShort(session.date)} ${time} ${session.title}${
        session.paid ? "，付費場次" : ""
      }${cancelled ? "，已取消" : ""}`}
      className="flex w-full min-w-0 items-center gap-1.5 py-[3px] pl-1.5 pr-1 text-left transition hover:bg-white/[0.07]"
      style={{
        backgroundColor: cancelled
          ? "color-mix(in srgb, #9ca3af 8%, transparent)"
          : `color-mix(in srgb, ${accent} 16%, transparent)`,
        borderLeft: `3px solid ${cancelled ? "#6b7280" : accent}`,
      }}
    >
      <span
        className={`min-w-0 flex-1 truncate text-[11px] leading-[1.4] ${
          cancelled ? "text-white/40 line-through" : "text-white/85"
        }`}
      >
        <span className="tabular-nums">{time}</span> {session.title}
      </span>
      {session.paid && !cancelled && (
        <span
          className="shrink-0 text-[9px] font-bold leading-none"
          style={{ color: accent }}
        >
          付費
        </span>
      )}
      {cancelled && (
        <span className="shrink-0 text-[9px] leading-none text-white/40">已取消</span>
      )}
    </button>
  );
}
