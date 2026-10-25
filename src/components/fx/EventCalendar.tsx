"use client";

/**
 * F-E1 月曆 view（Brief §2.5）
 *
 * 數據用 page 已有嘅 getCachedPublishedEvents() 結果，月份前後切換只係切顯示、
 * 唔 refetch。預設 view = 列表（原有排版唔郁），列表一路由 EventFilter 負責。
 * 撳日子出嚟嘅詳情重用現有 EventCard，完全冇改佢。
 *
 * 時區：event_date 係 'YYYY-MM-DD' 字串，一律用 Date.UTC／逐段切分處理，
 * 唔用 new Date('YYYY-MM-DD')（會被當 UTC parse，本地 getDay/getDate 可能差一日）。
 *
 * Hydration：初始月份同初始選取日子都係由 events 資料本身推導（唔係由「今日」計），
 * 所以 server 同 client 第一次 render 完全一致。
 *
 * ── 階段二動效（T-4 E10，方砚）──────────────────────────────────────
 * 「列表 / 月曆」切換原本係硬切、無退場，呢度加 `AnimatePresence mode="wait"`：
 * 退場 0.16s 播完，進場 0.22s 先開始，兩者任何一幀都唔重疊。
 *
 * ⚠️ R1 / 紅線 10（「無 JS 時內容 100% 可見」）：
 *    motion 嘅 `initial={{ opacity: 0 }}` 會喺 SSR 寫入 inline style，
 *    JS 一失敗內容就永久隱形。所以呢度兩層防護：
 *      1. `AnimatePresence initial={false}`（只對第一次 render 生效）
 *      2. `initial: ready ? {...} : false`，`ready` 由 `useMotionReady()`
 *         喺 mount 成功之後先變 true
 *    → SSR HTML 只會輸出 `animate` 嘅可見態（opacity:1、y:0）。
 *
 * ⚠️ 邊界：EventCalendar 只畀 `/events` 用，motion 唔會外流去首頁（紅線 5 / R3）。
 */

import { useMemo, useState } from "react";
import { AnimatePresence, motion, type MotionProps } from "motion/react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { EventCard } from "@/components/EventCard";
import { EventFilter } from "@/components/fx/EventFilter";
import { MotionRoot, useMotionReady } from "@/components/motion/MotionRoot";
import {
  MOTION_ENABLED,
  T_VIEW_IN,
  T_VIEW_OUT,
  VIEW_SHIFT,
} from "@/components/motion/motionConfig";
import { monthLabel, weekdayLabel } from "@/lib/utils";
import { DEFAULT_PAGES, type SitePageEvents } from "@/lib/content";
import type { Event } from "@/lib/types";

type View = "list" | "calendar";

const VIEW_OPTIONS: { key: View; label: string }[] = [
  { key: "list", label: "列表" },
  { key: "calendar", label: "月曆" },
];

/**
 * 週一開始嘅星期標籤：由 utils 嘅 weekdayLabel 生成，唔再另外寫一份星期對照表。
 * 2000-01-01 係星期六（getDay() === 6）。
 */
const WEEK_LABELS = [1, 2, 3, 4, 5, 6, 0].map((weekday) =>
  weekdayLabel(new Date(2000, 0, 1 + ((weekday - 6 + 7) % 7)))
);

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 'YYYY-MM' → 該月 1 號係星期幾偏移量（週一開始）+ 該月總日數 */
function monthShape(month: string): { offset: number; days: number } {
  const [y, m] = month.split("-").map(Number);
  const firstUtc = new Date(Date.UTC(y, m - 1, 1));
  return {
    offset: (firstUtc.getUTCDay() + 6) % 7,
    days: new Date(Date.UTC(y, m, 0)).getUTCDate(),
  };
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/**
 * 'YYYY-MM-DD' → 本地日期顯示（同既有 formatDate 一樣係 YYYY/MM/DD）。
 * 唔直接 call formatDate：佢入面用 new Date(str) parse，純日期會被當 UTC，
 * 喺負時區會差一日；呢度直接用字串切出嚟嘅年月日。
 */
function dateText(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : day;
}

export function EventCalendar({
  events,
  labels = DEFAULT_PAGES.events,
  isLoggedIn = false,
  registeredEventIds = [],
}: {
  events: Event[];
  labels?: SitePageEvents;
  /** T-26：會員登入狀態與已報名活動 id（傳落 EventCard 的站內報名按鈕） */
  isLoggedIn?: boolean;
  registeredEventIds?: string[];
}) {
  const [view, setView] = useState<View>("list");

  // 初始月份 / 初始選取日子：由資料本身推導，SSR 與 hydration 一致
  const [month, setMonth] = useState(() =>
    events.length ? events[0].event_date.slice(0, 7) : ""
  );
  const [selected, setSelected] = useState<string | null>(() =>
    events.length ? events[0].event_date.slice(0, 10) : null
  );

  /** 'YYYY-MM-DD' → 該日活動 */
  const byDate = useMemo(() => {
    const map = new Map<string, Event[]>();
    for (const e of events) {
      const key = e.event_date.slice(0, 10);
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    return map;
  }, [events]);

  /** 月曆格：null = 月初前面嘅空格 */
  const cells = useMemo<(string | null)[]>(() => {
    if (!month) return [];
    const { offset, days } = monthShape(month);
    const out: (string | null)[] = Array.from({ length: offset }, () => null);
    for (let d = 1; d <= days; d += 1) out.push(`${month}-${pad2(d)}`);
    return out;
  }, [month]);

  /** 切咗月份之後，舊嘅選取日子唔喺畫面入面 → 退返去嗰個月第一個有活動嘅日子 */
  const activeDate = useMemo(() => {
    if (selected && selected.startsWith(month)) return selected;
    return cells.find((c) => c && byDate.has(c)) ?? null;
  }, [selected, month, cells, byDate]);

  const activeEvents = activeDate ? byDate.get(activeDate) ?? [] : [];

  /**
   * T-4（E10）進／退場參數（§5）：進場 0.22s、退場 0.16s，位移只動 transform。
   * `ready === false`（SSR / 首次 hydration）時 `initial={false}` → 完全可見。
   */
  const ready = useMotionReady();

  const viewMotion: MotionProps = MOTION_ENABLED
    ? {
        initial: ready ? { opacity: 0, y: VIEW_SHIFT } : false,
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8, transition: T_VIEW_OUT },
        transition: T_VIEW_IN,
      }
    : {};

  if (!events.length) return null;

  return (
    <MotionRoot>
      <section className="container-msw section-pad">
        <div className="flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-8">
          <div>
            <h2 className="display-xl mt-5">最新活動</h2>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {/* 列表 / 月曆 一鍵切換 */}
            <div role="group" aria-label="顯示模式" className="flex gap-2">
              {VIEW_OPTIONS.map((opt) => {
                const active = opt.key === view;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setView(opt.key)}
                    className={`stat-figure inline-flex min-h-11 items-center px-4 text-sm transition ${
                      active
                        ? "slab bg-vital text-white"
                        : "text-white/60 hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* T-4（E10）：mode="wait" — 上一段播完退場，下一段先開始進場 */}
        <AnimatePresence mode="wait" initial={false}>
          {view === "list" ? (
            <motion.div key="list" {...viewMotion}>
              <EventFilter
                events={events}
                labels={labels}
                isLoggedIn={isLoggedIn}
                registeredEventIds={registeredEventIds}
              />
            </motion.div>
          ) : (
            <motion.div key="calendar" {...viewMotion}>
              <div className="mt-10">
                {/* 月份前後切換：只切顯示，唔 refetch */}
                <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-5">
                  <button
                    type="button"
                    onClick={() => setMonth((m) => shiftMonth(m, -1))}
                    className="slab inline-flex min-h-11 min-w-11 items-center justify-center border border-[var(--line-fine)] bg-white/[0.03] transition hover:bg-white/[0.08]"
                  >
                    <ChevronLeft size={18} aria-hidden />
                    <span className="sr-only">上個月</span>
                  </button>

                  <span className="stat-figure text-lg text-white">
                    {monthLabel(month)}
                  </span>

                  <button
                    type="button"
                    onClick={() => setMonth((m) => shiftMonth(m, 1))}
                    className="slab inline-flex min-h-11 min-w-11 items-center justify-center border border-[var(--line-fine)] bg-white/[0.03] transition hover:bg-white/[0.08]"
                  >
                    <ChevronRight size={18} aria-hidden />
                    <span className="sr-only">下個月</span>
                  </button>
                </div>

                {/* 月曆格：週一開始 */}
                <div className="mt-6 grid grid-cols-7 border-l border-t border-white/10">
                  {WEEK_LABELS.map((w) => (
                    <div
                      key={w}
                      className="border-b border-r border-white/10 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45"
                    >
                      {w}
                    </div>
                  ))}

                  {cells.map((date, i) => {
                    if (!date) {
                      return (
                        <div
                          key={`blank-${i}`}
                          className="border-b border-r border-white/10 bg-white/[0.02]"
                        />
                      );
                    }

                    const day = Number(date.slice(8));
                    const dayEvents = byDate.get(date) ?? [];

                    if (!dayEvents.length) {
                      return (
                        <div
                          key={date}
                          className="min-w-0 border-b border-r border-white/10 p-2"
                        >
                          <span className="stat-figure block text-right text-xs text-white/30">
                            {day}
                          </span>
                        </div>
                      );
                    }

                    const active = date === activeDate;
                    return (
                      <div
                        key={date}
                        className="min-w-0 border-b border-r border-white/10 p-1.5"
                      >
                        <button
                          type="button"
                          aria-pressed={active}
                          onClick={() => setSelected(date)}
                          className={`block min-h-[3.25rem] w-full px-1.5 py-1 text-left transition ${
                            active
                              ? "bg-vital/20"
                              : "bg-white/[0.03] hover:bg-white/[0.08]"
                          }`}
                        >
                          <span className="stat-figure block text-xs text-white">
                            {day}
                          </span>
                          <span className="mt-1 block truncate text-[10px] leading-tight text-vital-bright">
                            {dayEvents[0].title}
                            {dayEvents.length > 1
                              ? ` +${dayEvents.length - 1}`
                              : ""}
                          </span>
                          <span className="sr-only">
                            {day} 日，{dayEvents.length} 個活動
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* 撳日子 → 下方顯示該日活動（重用 EventCard） */}
                {activeEvents.length > 0 ? (
                  <div className="mt-10">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
                      <CalendarDays size={14} />
                      <span className="tnum">{dateText(activeDate ?? "")}</span>
                    </div>
                    <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                      {activeEvents.map((e) => (
                        <EventCard
                          key={e.id}
                          event={e}
                          labels={labels}
                          isLoggedIn={isLoggedIn}
                          registered={registeredEventIds.includes(e.id)}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </MotionRoot>
  );
}
