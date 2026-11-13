"use client";

import { useMemo, useState } from "react";
import { SessionDetailPanel } from "./SessionDetailPanel";
import { ScheduleLegend } from "./ScheduleLegend";
import {
  PAID_HEX,
  WEEKDAY_LABELS,
  colorHex,
  formatDayShort,
  formatMonthTitle,
  type ScheduleDay,
  type ScheduleSessionView,
} from "./schedule-utils";
import type { ScheduleLegendItem } from "@/lib/types";

/** 桌面每格最多顯示幾個 pill，其餘收成 +N */
const MAX_PILLS_DESKTOP = 3;
/** 平板 pill 更窄，只放 2 個 */
const MAX_PILLS_TABLET = 2;
/** 手機每格最多幾條顏色短條 */
const MAX_BARS_MOBILE = 3;
/** 已取消的顏色條／色塊統一用灰（與詳情面板一致） */
const CANCELLED_HEX = "#6b7280";

/**
 * 班表日曆 —— **所有斷點都是月曆**（7 欄 × 5–6 列），只調整密度。
 *
 * 客戶原話：「不要週檢視，要用月曆放進手機（現況），如果看不到，上方可以說明
 * 顏色所代表的活動，並且後台同步」
 *
 *   桌面（≥1024）  格子顯示 pill：`19:00 街健基礎力量`，最多 3 個，超過 +N
 *   平板（768–1023）pill 只顯示時間 + 課名、字縮小，最多 2 個，超過 +N
 *   手機（<768）   格子至少 56px 高；每場只畫一條高 4px、滿格的顏色短條，
 *                  不寫任何文字；超過 3 場顯示 +N。
 *
 * 點擊行為三個斷點一致：整格都有一層 inset-0 的按鈕，點格子任何非 pill 的位置
 * （含 `+N`）→ 開當日場次清單；pill 本身（z-20）→ 直接開單場詳情。
 *
 * 手機不放課名的原因很實際：390 寬 ÷ 7 欄 ≈ 52px，任何課名都會被截成
 * 「街健基…」這種看不懂的東西。顏色短條 + 上方圖例才是能讀的版本。
 *
 * 手機不橫向捲動：7 欄等寬、每個容器 min-w-0、日期數字 13px，
 * 390 寬下 scrollWidth === clientWidth。
 *
 * 場次資料（含 HYROX 付費場次）由 Server Component 攤平成 ScheduleSessionView 後傳入，
 * 這裡只管畫與互動，不碰資料庫、不做日期計算以外的業務判斷。
 */
export function ScheduleCalendar({
  year,
  month,
  days,
  legend,
  todayISO,
}: {
  year: number;
  month: number;
  days: ScheduleDay[];
  /** 顏色圖例（後台可編輯）；空陣列 = 整段不顯示 */
  legend: ScheduleLegendItem[];
  /** Asia/Macau 的今天（server 算好傳入），詳情面板據此判斷已結束／今天／可報名 */
  todayISO: string;
}) {
  /** 手機第一層：哪一天被打開 */
  const [dayKey, setDayKey] = useState<string | null>(null);
  /** 第二層：哪一場被打開（有值時蓋過 dayKey） */
  const [selected, setSelected] = useState<ScheduleSessionView | null>(null);

  const activeDay = useMemo(
    () => (dayKey ? days.find((day) => day.date === dayKey) ?? null : null),
    [dayKey, days]
  );

  const hasAnySession = days.some((day) => day.inMonth && day.sessions.length > 0);

  function openDay(day: ScheduleDay) {
    if (!day.inMonth || day.sessions.length === 0) return;
    setDayKey(day.date);
    setSelected(null);
  }

  function openSession(session: ScheduleSessionView) {
    setDayKey(null);
    setSelected(session);
  }

  function closePanel() {
    setDayKey(null);
    setSelected(null);
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-black tracking-tight text-white md:text-xl">
          {formatMonthTitle(year, month)}班表
        </h3>

        {/* 舊的兩項說明：手機隱藏，把空間讓給上方顏色圖例 */}
        <div className="hidden items-center gap-4 text-[11px] text-white/50 md:flex">
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

      {/* 顏色圖例：標題列下方、格子上方，手機與桌面都顯示。
          legend 為空（migration 未執行）時整段不 render，不留空行。 */}
      {legend.length > 0 && (
        <div className="mt-4">
          <ScheduleLegend items={legend} />
        </div>
      )}

      {!hasAnySession && (
        <p className="mt-4 border border-dashed border-white/15 bg-white/[0.02] px-4 py-3 text-sm text-white/60">
          本月暫無場次，班表更新後會出現在這裡。
        </p>
      )}

      {/* ================= 月曆（全斷點共用，只調密度） ================= */}
      <div className="mt-5 min-w-0">
        <div
          className="grid min-w-0 grid-cols-7 border-l border-t border-white/10"
          role="group"
          aria-label={`${formatMonthTitle(year, month)}班表`}
        >
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="min-w-0 border-b border-r border-white/10 bg-white/[0.03] py-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-white/45 md:py-2 md:text-[11px] md:tracking-[0.18em]"
            >
              <span aria-hidden className="md:hidden">
                {label}
              </span>
              <span className="hidden md:inline">週{label}</span>
            </div>
          ))}

          {days.map((day) => {
            const interactive = day.inMonth && day.sessions.length > 0;
            const extraBars = Math.max(day.sessions.length - MAX_BARS_MOBILE, 0);

            return (
              <div
                key={day.date}
                className={`relative min-h-[56px] min-w-0 overflow-hidden border-b border-r border-white/10 p-1 md:min-h-[92px] md:p-1.5 lg:min-h-[126px] lg:p-2 ${
                  day.isToday
                    ? "bg-cobalt/[0.14] ring-1 ring-inset ring-cobalt-bright/60"
                    : day.inMonth
                      ? "bg-ink-soft/40"
                      : "bg-transparent"
                }`}
              >
                {/* 整格是點擊區，**所有斷點都掛**（原本只有 md:hidden，導致
                    768–1023px 既吃不到手機點擊層、pill 又被 container 擋住，
                    第 3 堂之後完全點不開）。手機靠它開當日清單；平板／桌面
                    點 pill 以外的地方（含 +N、日期數字、空白）也走這裡。 */}
                {interactive && (
                  <button
                    type="button"
                    onClick={() => openDay(day)}
                    aria-label={`${formatDayShort(day.date)}，${
                      day.sessions.length
                    } 個場次，點擊查看當日場次`}
                    className="absolute inset-0 z-10 cursor-pointer"
                  />
                )}

                <div className="flex items-baseline justify-between gap-1">
                  <span
                    className={`text-[13px] font-bold tabular-nums md:text-[11px] ${
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
                    <span className="hidden text-[9px] font-semibold uppercase tracking-[0.16em] text-vital-bright md:inline">
                      今天
                    </span>
                  )}
                </div>

                {/* ---------- 手機：顏色短條，不顯示文字 ---------- */}
                <div className="mt-1 space-y-[2px] md:hidden" aria-hidden>
                  {day.sessions.slice(0, MAX_BARS_MOBILE).map((session) => (
                    <span
                      key={`${session.kind}-${session.id}`}
                      className="block h-1 w-full rounded-[1px]"
                      style={{ backgroundColor: sessionBarColor(session) }}
                    />
                  ))}
                  {extraBars > 0 && (
                    <span className="block text-[9px] font-semibold leading-none text-white/45">
                      +{extraBars}
                    </span>
                  )}
                </div>

                {/* ---------- 平板：compact pill，最多 2 個 ----------
                    容器 pointer-events-none：只有 pill 本身吃點擊，
                    其餘區域（含 +N）穿透到下面的整格按鈕 → 開當日清單 */}
                <div className="pointer-events-none relative z-20 mt-1.5 hidden min-w-0 space-y-1 md:block lg:hidden">
                  {day.sessions.slice(0, MAX_PILLS_TABLET).map((session) => (
                    <SessionPill
                      key={`${session.kind}-${session.id}`}
                      session={session}
                      compact
                      onSelect={openSession}
                    />
                  ))}
                  {day.sessions.length > MAX_PILLS_TABLET && (
                    <button
                      type="button"
                      onClick={() => openDay(day)}
                      aria-label={`還有 ${
                        day.sessions.length - MAX_PILLS_TABLET
                      } 個場次，點擊看當日全部場次`}
                      className="pointer-events-auto block w-full cursor-pointer pl-1 text-left text-[10px] font-semibold text-white/45 transition hover:text-white"
                    >
                      +{day.sessions.length - MAX_PILLS_TABLET}
                    </button>
                  )}
                </div>

                {/* ---------- 桌面：完整 pill，最多 3 個 ---------- */}
                <div className="pointer-events-none relative z-20 mt-1.5 hidden min-w-0 space-y-1 lg:block">
                  {day.sessions.slice(0, MAX_PILLS_DESKTOP).map((session) => (
                    <SessionPill
                      key={`${session.kind}-${session.id}`}
                      session={session}
                      onSelect={openSession}
                    />
                  ))}
                  {day.sessions.length > MAX_PILLS_DESKTOP && (
                    <button
                      type="button"
                      onClick={() => openDay(day)}
                      aria-label={`還有 ${
                        day.sessions.length - MAX_PILLS_DESKTOP
                      } 個場次，點擊看當日全部場次`}
                      className="pointer-events-auto block w-full cursor-pointer pl-1.5 text-left text-[10px] font-semibold text-white/45 transition hover:text-white"
                    >
                      +{day.sessions.length - MAX_PILLS_DESKTOP}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <SessionDetailPanel
        day={activeDay}
        session={selected}
        todayISO={todayISO}
        onSelectSession={setSelected}
        onBack={() => setSelected(null)}
        onClose={closePanel}
      />
    </div>
  );
}

/** 手機顏色短條的顏色：已取消 → 灰；付費 → 橙；其餘依課程色票 */
function sessionBarColor(session: ScheduleSessionView): string {
  if (session.status === "cancelled") return CANCELLED_HEX;
  return session.paid ? PAID_HEX : colorHex(session.colorKey);
}

/**
 * 一個場次 pill：時間 + 課程名，左側顏色條依 class_color_key；
 * 付費場次整體轉橙並帶「付費」小標；已取消加刪除線並灰化（但仍可點開看原因）。
 *
 * `compact` 給平板用：字縮一級、去掉「付費／已取消」小標（那兩個字在這個
 * 寬度會把課名擠掉），但仍保留左側色條與刪除線，狀態不會因此看不出來。
 */
function SessionPill({
  session,
  compact = false,
  onSelect,
}: {
  session: ScheduleSessionView;
  compact?: boolean;
  onSelect: (session: ScheduleSessionView) => void;
}) {
  const cancelled = session.status === "cancelled";
  const accent = cancelled
    ? CANCELLED_HEX
    : session.paid
      ? PAID_HEX
      : colorHex(session.colorKey);
  const time = session.startTime ?? "待定";

  return (
    <button
      type="button"
      onClick={() => onSelect(session)}
      aria-label={`${formatDayShort(session.date)} ${time} ${session.title}${
        session.paid ? "，付費場次" : ""
      }${cancelled ? "，已取消" : ""}`}
      className={`pointer-events-auto flex w-full min-w-0 cursor-pointer items-center gap-1.5 text-left transition hover:bg-white/[0.07] ${
        compact ? "py-[2px] pl-1 pr-0.5" : "py-[3px] pl-1.5 pr-1"
      }`}
      style={{
        backgroundColor: cancelled
          ? "color-mix(in srgb, #9ca3af 8%, transparent)"
          : `color-mix(in srgb, ${accent} 16%, transparent)`,
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <span
        className={`min-w-0 flex-1 truncate leading-[1.4] ${
          compact ? "text-[10px]" : "text-[11px]"
        } ${cancelled ? "text-white/40 line-through" : "text-white/85"}`}
      >
        <span className="tabular-nums">{time}</span> {session.title}
      </span>
      {!compact && session.paid && !cancelled && (
        <span
          className="shrink-0 text-[9px] font-bold leading-none"
          style={{ color: accent }}
        >
          付費
        </span>
      )}
      {!compact && cancelled && (
        <span className="shrink-0 text-[9px] leading-none text-white/40">已取消</span>
      )}
    </button>
  );
}
