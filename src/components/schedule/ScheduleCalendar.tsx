"use client";

import { useState } from "react";
import Link from "next/link";
import { SessionDetailPanel } from "./SessionDetailPanel";
import { ScheduleLegend } from "./ScheduleLegend";
import {
  PAID_HEX,
  RACE_HEX,
  RACE_LABEL,
  WEEKDAY_LABELS,
  formatDayLong,
  formatDayShort,
  formatMonthTitle,
  sessionAccentHex,
  type ScheduleDay,
  type ScheduleSessionView,
} from "./schedule-utils";
import type { ScheduleLegendItem } from "@/lib/types";

/** 桌面每格最多顯示幾個 pill，其餘收成 +N */
const MAX_PILLS_DESKTOP = 3;
/** 平板 pill 更窄，只放 2 個 */
const MAX_PILLS_TABLET = 2;

/**
 * 班表日曆 —— **兩個斷點，兩種形態**。
 *
 * 客戶原話：「不要週檢視，要用月曆放進手機（現況），如果看不到，上方可以說明
 * 顏色所代表的活動，並且後台同步」
 * 2026-11 站主補一句：「手機介面是首要」——手機要睇得出邊日有 HYROX／比賽。
 *
 *   平板／桌面（≥768）月曆 grid（7 欄 × 5–6 列），只調整密度：
 *     桌面（≥1024）    格子顯示 pill：`19:00 街健基礎力量`，最多 3 個，超過 +N
 *     平板（768–1023） pill 只顯示時間 + 課名、字縮小，最多 2 個，超過 +N
 *
 *   手機（<768）      改為**當月議程清單**：逐日一個日期標題，下面逐行
 *                     `19:30–21:00 完整場次名 [付費場次／比賽]`，每行可點開詳情。
 *
 * 為什麼手機唔再畫 42 格：390 寬 ÷ 7 欄 ≈ 52px，格內任何課名都會被截成
 * 「街健基…」，只能靠顏色短條 + 圖例去猜；站主實測回饋「睇唔出邊日有 HYROX／比賽」。
 * 議程清單讓場次名完整可讀，代價是沒有「一屏看完整個月」的版面感——
 * 站主已明確選了可讀性。
 *
 * 點擊行為兩個斷點一致：每行 → 同一個 `openSession()` → 同一個詳情面板。
 *
 * 場次資料（含 HYROX 付費場次）由 Server Component 攤平成 ScheduleSessionView 後傳入，
 * 這裡只管畫與互動，不碰資料庫、不做日期計算以外的業務判斷。
 */
export function ScheduleCalendar({
  year,
  month,
  days,
  legend,
  classesByColor,
  todayISO,
  compact = false,
  headingSuffix = "班表",
}: {
  year: number;
  month: number;
  days: ScheduleDay[];
  /** 顏色圖例（後台可編輯）；空陣列 = 整段不顯示 */
  legend: ScheduleLegendItem[];
  /** 色票鍵 → 課程名（getClassNamesByColor）；圖例文字以課程名為準，缺色才退 label */
  classesByColor?: Record<string, string[]>;
  /** Asia/Macau 的今天（server 算好傳入），詳情面板據此判斷已結束／今天／可報名 */
  todayISO: string;
  /**
   * 精簡模式（首頁「本月場次」區塊）：手機只留月曆格 + 顏色短條，
   * 不顯示圖例全文。桌面上仍顯示完整圖例，所以同一個元件兩種密度。
   */
  compact?: boolean;
  /**
   * 標題尾字，預設「班表」。
   * `/events` 在「該月只有賽事、班表還沒發布」時傳「賽事」，
   * 因為那時的月曆上真的一堂課都沒有，寫「班表」是錯的。
   */
  headingSuffix?: string;
}) {
  /** 第二層：哪一場被打開（有值時開單場詳情面板） */
  const [selected, setSelected] = useState<ScheduleSessionView | null>(null);

  const hasAnySession = days.some((day) => day.inMonth && day.sessions.length > 0);

  /**
   * 手機議程清單的資料：只留「本月且有場次」的日子。
   * `days` 本身含前後補格（inMonth = false），那些是給 grid 排版用的，
   * 議程清單列出來只會多出一堆跨月空日。
   */
  const agendaDays = days.filter(
    (day) => day.inMonth && day.sessions.length > 0
  );

  /** 這個月有沒有賽事：決定要不要在圖例裡補一項「比賽」 */
  const hasRaceDay = days.some(
    (day) => day.inMonth && day.sessions.some((s) => s.kind === "race")
  );

  /**
   * 圖例 = 後台維護的課程色票 + （有賽事時）一項「比賽」。
   *
   * 「比賽」刻意**不寫進資料庫**的 schedule_legend：那張表是站主編輯課程顏色的地方，
   * 賽事顏色由程式定義（RACE_HEX），寫進 DB 反而會多一份要同步的真相。
   * 這裡只是把一個靜態項接在後台資料前面，color_key 用 "race"，
   * 讓 ScheduleLegend 走同一個 colorHex() 解析，色塊與格子上的顏色必然一致。
   */
  const legendItems: ScheduleLegendItem[] = hasRaceDay
    ? [{ color_key: "race", label: RACE_LABEL, sort_order: -1 }, ...legend]
    : legend;

  function openSession(session: ScheduleSessionView) {
    setSelected(session);
  }

  function closePanel() {
    setSelected(null);
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-black tracking-tight text-white md:text-xl">
          {formatMonthTitle(year, month)}
          {headingSuffix}
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
          {hasRaceDay && (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-[3px]"
                style={{ backgroundColor: RACE_HEX }}
              />
              <span style={{ color: RACE_HEX }}>{RACE_LABEL}</span>
            </span>
          )}
        </div>
      </div>

      {/* 顏色圖例：標題列下方、格子上方，手機與桌面都顯示。
          legend 為空（migration 未執行）時整段不 render，不留空行。
          compact（首頁版）在手機隱藏圖例全文：首頁只要「看一眼有沒有課」，
          完整的顏色對照留給 /events，避免首頁多出五、六行文字把高度撐爆。 */}
      {legendItems.length > 0 && (
        <div className={`mt-4 ${compact ? "hidden md:block" : ""}`}>
          <ScheduleLegend items={legendItems} classesByColor={classesByColor} />
        </div>
      )}

      {!hasAnySession && (
        <p className="mt-4 border border-dashed border-white/15 bg-white/[0.02] px-4 py-3 text-sm text-white/60">
          本月暫無場次，班表更新後會出現在這裡。
        </p>
      )}

      {/* ================= 手機（<768）：當月議程清單 =================
          站主 2026-11：「手機介面是首要」「睇唔出邊日有 HYROX／比賽」。
          42 格 grid 在 390 寬每格只有 ~52px，放唔落場次名，所以手機改成
          逐日議程：日期標題 + 每場一行（時間、完整場次名、狀態徽章），
          每行點開同一個詳情面板（onSelect → openSession）。
          只列有場次的日子；整月冇場次時，上面的空狀態已經講清楚。
          純靜態 markup（server render 出嚟就有），關掉 JS 都讀得到全部場次名。 */}
      <div className="mt-5 md:hidden">
        <ol
          aria-label={`${formatMonthTitle(year, month)}${headingSuffix}`}
          className="border-t border-white/10"
        >
          {agendaDays.map((day) => (
            <li key={day.date} className="border-b border-white/10 py-3">
              <div className="flex items-center gap-2">
                <h4
                  className={`text-sm font-bold tracking-tight ${
                    day.isToday ? "text-vital-bright" : "text-white/85"
                  }`}
                >
                  {formatDayLong(day.date)}
                </h4>
                {day.isToday && (
                  <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.16em] text-vital-bright">
                    今天
                  </span>
                )}
              </div>

              <ul className="mt-2 space-y-1.5">
                {day.sessions.map((session) => (
                  <li key={`${session.kind}-${session.id}-${session.date}`}>
                    <AgendaRow session={session} onSelect={openSession} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>

      {/* ================= 平板／桌面（≥768）：月曆 grid =================
          版面與改動前完全一致（只在外層加了 hidden md:block）。
          手機專用的顏色短條與「賽」字徽章已移除：它們掛在 md:hidden，
          而整個 grid 在手機已經不渲染，屬不可能再出現的死碼。 */}
      <div className="mt-5 hidden min-w-0 md:block">
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
            /**
             * 賽事（kind = "race"）在這一格的處理。
             *
             * 手機格子只有 ~44px 寬，放不下「廣州 HYROX 2026」，所以：
             *   · 日期數字旁只放一個單字徽章「賽」（見下方日期列）
             *   · 完整名稱由 pill（平板以上）與賽事頁承接
             *
             * `raceOnly`：這天只有賽事、沒有任何課堂或 HYROX 付費場時，
             * 整格直接連到賽事頁。手機已改為議程清單，但平板（768–1023）
             * 仍然是 grid，這條規則要繼續生效。
             */
            const firstRace = day.sessions.find((s) => s.kind === "race") ?? null;
            const hasRace = firstRace !== null;
            const raceOnly =
              firstRace !== null && day.sessions.every((s) => s.kind === "race");

            const cellHref =
              raceOnly && firstRace
                ? `/races/${firstRace.id}`
                : `/training/${day.date}`;
            const cellLabel =
              raceOnly && firstRace
                ? `${formatDayShort(day.date)}，比賽：${firstRace.title}，點擊看賽事`
                : day.sessions.length > 0
                  ? `${formatDayShort(day.date)}，${day.sessions.length} 個場次${
                      hasRace ? "，含比賽" : ""
                    }，點擊看當日場次`
                  : `${formatDayShort(day.date)}，當日無場次，點擊查看`;

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
                {/* 整格是連到當日頁的連結（**所有斷點都掛**）。
                    2026-11「日曆太難找、點日期不能進去看當日內容」的修正：
                    原本點格子是開一個彈出面板，面板關掉就什麼都不留、也不能分享；
                    現在每個本月格子都是 `/training/YYYY-MM-DD` 的連結，
                    日期頁有完整場次、名額與報名入口，而且可以加書籤／分享。
                    沒有場次的日子**也連**：日期頁會顯示「當日無場次」＋前後日導覽，
                    比「點了沒反應」清楚。
                    只有賽事的日子改連 `/races/[id]`（見上方 raceOnly 的說明）。 */}
                {day.inMonth && (
                  <Link
                    href={cellHref}
                    aria-label={cellLabel}
                    className="absolute inset-0 z-10 cursor-pointer transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-vital-bright"
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
                  {/* 賽事徽章：平板以上由 pill 上的「比賽」／「賽」表示，
                      日期列這裡不再重複畫（手機版已改為議程清單，場次名直接寫出來）。 */}
                  {day.isToday && (
                    <span className="hidden text-[9px] font-semibold uppercase tracking-[0.16em] text-vital-bright md:inline">
                      今天
                    </span>
                  )}
                </div>

                {/* ---------- 平板：compact pill，最多 2 個 ----------
                    容器 pointer-events-none：只有 pill 本身吃點擊，
                    其餘區域（含 +N）穿透到下面的整格按鈕 → 開當日清單 */}
                <div className="pointer-events-none relative z-20 mt-1.5 hidden min-w-0 space-y-1 md:block lg:hidden">
                  {day.sessions.slice(0, MAX_PILLS_TABLET).map((session) => (
                    <SessionPill
                      key={`${session.kind}-${session.id}-${session.date}`}
                      session={session}
                      compact
                      onSelect={openSession}
                    />
                  ))}
                  {day.sessions.length > MAX_PILLS_TABLET && (
                    <Link
                      href={`/training/${day.date}`}
                      aria-label={`還有 ${
                        day.sessions.length - MAX_PILLS_TABLET
                      } 個場次，點擊看當日全部場次`}
                      className="pointer-events-auto block w-full cursor-pointer pl-1 text-left text-[10px] font-semibold text-white/45 transition hover:text-white"
                    >
                      +{day.sessions.length - MAX_PILLS_TABLET}
                    </Link>
                  )}
                </div>

                {/* ---------- 桌面：完整 pill，最多 3 個 ---------- */}
                <div className="pointer-events-none relative z-20 mt-1.5 hidden min-w-0 space-y-1 lg:block">
                  {day.sessions.slice(0, MAX_PILLS_DESKTOP).map((session) => (
                    <SessionPill
                      key={`${session.kind}-${session.id}-${session.date}`}
                      session={session}
                      onSelect={openSession}
                    />
                  ))}
                  {day.sessions.length > MAX_PILLS_DESKTOP && (
                    <Link
                      href={`/training/${day.date}`}
                      aria-label={`還有 ${
                        day.sessions.length - MAX_PILLS_DESKTOP
                      } 個場次，點擊看當日全部場次`}
                      className="pointer-events-auto block w-full cursor-pointer pl-1.5 text-left text-[10px] font-semibold text-white/45 transition hover:text-white"
                    >
                      +{day.sessions.length - MAX_PILLS_DESKTOP}
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 面板只剩「單場詳情」一種模式：當日清單已由 `/training/[date]` 承接，
          點格子是換頁而不是開面板（面板關掉後什麼都不留，也不能分享）。 */}
      <SessionDetailPanel
        day={null}
        session={selected}
        todayISO={todayISO}
        onSelectSession={setSelected}
        onBack={() => setSelected(null)}
        onClose={closePanel}
      />
    </div>
  );
}

/**
 * 手機議程清單的一行：時間 + **完整場次名** + 狀態徽章。
 *
 * 同 SessionPill 的分工：
 *   · SessionPill 是「格子裡的小標籤」（平板／桌面），寬度有限，課名會 truncate；
 *   · AgendaRow 是「清單項」（手機），站主要求睇得出邊場係 HYROX／比賽，
 *     所以場次名不截斷（`break-words` 必要時換行），徽章寫成文字
 *     （付費場次／比賽／已取消），不靠顏色分辨。
 *
 * 觸控：`min-h-11` = 44px 起跳，符合本專案的手機目標尺寸。
 * 點擊 → 同一個 `onSelect` → 同一個詳情面板（不另做一套）。
 *
 * 註：剩餘名額唔喺呢一行顯示——`ScheduleSessionView` 冇 remaining／taken
 * 欄位（座位數只存在於 `session_seats` 檢視，由日期頁自己查），
 * 要加就得改資料層，本輪禁區。
 */
function AgendaRow({
  session,
  onSelect,
}: {
  session: ScheduleSessionView;
  onSelect: (session: ScheduleSessionView) => void;
}) {
  const cancelled = session.status === "cancelled";
  const isRace = session.kind === "race";
  const accent = sessionAccentHex(session);
  // 議程有位置寫完整時間段，唔止開始時間
  const time =
    session.startTime && session.endTime
      ? `${session.startTime}–${session.endTime}`
      : session.startTime ?? "待定";

  const badge = (color: string, text: string) => (
    <span
      className="shrink-0 border px-1.5 py-0.5 text-[10px] font-bold"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      {text}
    </span>
  );

  return (
    <button
      type="button"
      onClick={() => onSelect(session)}
      aria-label={`${formatDayShort(session.date)} ${time} ${session.title}${
        isRace ? "，比賽" : ""
      }${session.paid ? "，付費場次" : ""}${cancelled ? "，已取消" : ""}，看詳情`}
      className="flex min-h-11 w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left transition hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-vital-bright"
      style={{
        backgroundColor: cancelled
          ? "color-mix(in srgb, #9ca3af 8%, transparent)"
          : `color-mix(in srgb, ${accent} 14%, transparent)`,
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <span
        className={`shrink-0 text-[11px] font-semibold tabular-nums ${
          cancelled ? "text-white/40 line-through" : "text-white/80"
        }`}
      >
        {time}
      </span>
      <span
        className={`min-w-0 flex-1 break-words text-sm font-semibold ${
          cancelled ? "text-white/40 line-through" : "text-white"
        }`}
      >
        {session.title}
      </span>
      {isRace && !cancelled && badge(RACE_HEX, RACE_LABEL)}
      {session.paid && !cancelled && badge(PAID_HEX, "付費場次")}
      {cancelled && badge("#9ca3af", "已取消")}
    </button>
  );
}

/**
 * 一個場次 pill：時間 + 課程名，左側顏色條依 class_color_key；
 * 付費場次整體轉橙並帶「付費」小標；已取消加刪除線並灰化（但仍可點開看原因）；
 * 賽事（kind="race"）轉洋紅並帶「比賽」文字徽章（顏色不是唯一區分手段）。
 *
 * `compact` 給平板用：字縮一級、去掉「付費／已取消」小標（那兩個字在這個
 * 寬度會把課名擠掉），但仍保留左側色條與刪除線，狀態不會因此看不出來。
 * 賽事的徽章在 compact 下縮成單字「賽」——完全拿掉的話，平板就只能靠顏色
 * 分辨「課堂 / 比賽」，違反色盲可及性。
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
  const isRace = session.kind === "race";
  const accent = sessionAccentHex(session);
  const time = session.startTime ?? "待定";

  return (
    <button
      type="button"
      onClick={() => onSelect(session)}
      aria-label={`${formatDayShort(session.date)} ${time} ${session.title}${
        isRace ? "，比賽" : ""
      }${session.paid ? "，付費場次" : ""}${cancelled ? "，已取消" : ""}`}
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
      {/* 賽事徽章：文字一定在，不能只靠洋紅色分辨。
          平板格只有約 110px，用單字「賽」；桌面（lg）才寫「比賽」。 */}
      {isRace && !cancelled && (
        <span
          className="shrink-0 text-[9px] font-bold leading-none"
          style={{ color: accent }}
        >
          {compact ? "賽" : RACE_LABEL}
        </span>
      )}
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
