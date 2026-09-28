"use client";

/**
 * F-R1 達標計算機（Brief §2.4）
 *
 * 純前端計算：剩餘公里數 / 剩餘天數全部由 page 傳入（monthData.km、
 * RULES.MONTHLY_GOAL_KM、daysLeftInMonth()），唔加任何新 query。
 * 未登入（km = 0）都照計。
 *
 * Hydration：「今日」係瀏覽器狀態，透過 useSyncExternalStore 讀取
 * （server snapshot = null → SSR 出佔位符），client hydrate 後先補上真實值。
 */

import { useId, useState, useSyncExternalStore } from "react";
import { Route, TrendingUp } from "lucide-react";
import { formatKm } from "@/lib/utils";

/**
 * 拉桿範圍由 page 傳入（Brief §2.4 F-R1：1–20 km）。
 *
 * 點解唔喺呢度 export 常數畀 server component 用：
 * "use client" 模組嘅所有 export 喺 server 端會變成 client reference proxy，
 * 唔係數字——server 做四則運算會變 NaN。所以邊界值由 page（server）持有，
 * 以 props 傳落嚟。
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * 同既有 formatDate 嘅顯示格式一致（YYYY/MM/DD）。
 * 之所以唔直接 call formatDate：佢入面用 new Date(str) parse，
 * 純日期會被當 UTC，本地 getters 可以差一日；呢度直接用本地年月日組字串。
 */
function dateText(d: Date): string {
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

/** 'YYYY-MM-DD' + N 天 → 顯示用日期字串 */
function addDays(key: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  return dateText(
    new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)
  );
}

/**
 * 「今日」係外部（瀏覽器）狀態：用 useSyncExternalStore 讀，
 * server snapshot 固定係 null（SSR 輸出佔位符），client hydrate 後先補上真實值——
 * 呢個係 hydration-safe 嘅做法，唔使喺 useEffect 入面 setState。
 * snapshot 係當日日期字串（同一日內唔會變），唔會令 React 無限重 render。
 */
function subscribeNothing() {
  return () => {};
}
function clientTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function serverTodayKey(): null {
  return null;
}

export function GoalCalculator({
  currentKm,
  goalKm,
  daysLeft,
  initialPerDay,
  minPerDay,
  maxPerDay,
}: {
  /** 本月已確認里程（未登入為 0） */
  currentKm: number;
  /** 月度目標（RULES.MONTHLY_GOAL_KM） */
  goalKm: number;
  /** 本月剩餘天數（daysLeftInMonth()，由 page 傳入） */
  daysLeft: number;
  /** 拉桿初始值（由 page 依剩餘里程 / 剩餘天數推導，避免寫死數字） */
  initialPerDay: number;
  /** 拉桿下限（km） */
  minPerDay: number;
  /** 拉桿上限（km） */
  maxPerDay: number;
}) {
  const sliderId = useId();
  const [perDay, setPerDay] = useState(() =>
    clamp(initialPerDay, minPerDay, maxPerDay)
  );

  const todayKey = useSyncExternalStore(
    subscribeNothing,
    clientTodayKey,
    serverTodayKey
  );

  const remaining = Math.max(0, goalKm - currentKm);
  const daysNeeded = remaining > 0 ? Math.ceil(remaining / perDay) : 0;
  const targetDateText = todayKey ? addDays(todayKey, daysNeeded) : null;

  const onTrack = daysNeeded <= daysLeft;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <label
          htmlFor={sliderId}
          className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55"
        >
          每日公里數
        </label>
        <div className="flex items-end gap-1">
          <span className="stat-figure text-3xl leading-none text-accent-blue">
            {perDay}
          </span>
          <span className="text-accent-blue mb-1 text-[11px] font-semibold uppercase tracking-[0.22em]">
            km / day
          </span>
        </div>
      </div>

      {/* accentColor 用 CSS 變數，唔 hardcode 色碼 */}
      <input
        id={sliderId}
        type="range"
        min={minPerDay}
        max={maxPerDay}
        step={1}
        value={perDay}
        onChange={(e) =>
          setPerDay(clamp(Number(e.target.value), minPerDay, maxPerDay))
        }
        style={{ accentColor: "var(--color-vital)" }}
        className="mt-4 w-full"
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="slab border border-[var(--line-fine)] bg-white/[0.03] px-4 py-3">
          <div className="flex items-center gap-2 text-vital-bright">
            <Route size={16} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">
              預計達標日期
            </span>
          </div>
          <div className="stat-figure mt-2 text-2xl text-white">
            {targetDateText ?? "—"}
          </div>
          <div className="mt-1.5 text-[11px] text-white/55">
            還差 {formatKm(remaining)} 公里 · 需要 {daysNeeded} 天
          </div>
        </div>

        <div
          aria-live="polite"
          className={`slab border px-4 py-3 ${
            onTrack
              ? "border-emerald-500/40 bg-emerald-500/[0.07]"
              : "border-red-500/40 bg-red-500/[0.07]"
          }`}
        >
          <div className="flex items-center gap-2">
            <TrendingUp
              size={16}
              className={onTrack ? "text-emerald-300" : "text-red-300"}
            />
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
              {daysLeft} 天 · 本月剩餘
            </span>
          </div>
          <div
            className={`stat-figure mt-2 text-2xl ${
              onTrack ? "text-emerald-300" : "text-red-300"
            }`}
          >
            {onTrack ? "趕得切" : "要加油"}
          </div>
          <div className="mt-1.5 text-[11px] text-white/55">
            {formatKm(currentKm)} / {goalKm} km
          </div>
        </div>
      </div>
    </div>
  );
}
