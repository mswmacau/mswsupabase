"use client";

import { useEffect, useState } from "react";

/** 參考 HTML：每週一（TRAINING_WEEKDAY = 1 → getDay() === 1） */
const TARGET_WEEKDAY = 1;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 下一個週一 `hour:minute`（本地時間）。
 * 參考 HTML 嘅 `nextMonday()`：`d.setDate(n.getDate()+((8-n.getDay())%7||7))`
 * ——即係：今日係週一的話，倒數嘅係「下」週一，唔係今日。
 */
function nextMondayAt(hour: number, minute: number, now: Date): Date {
  const d = new Date(now);
  const delta = (7 + TARGET_WEEKDAY - now.getDay()) % 7;
  d.setDate(now.getDate() + (delta === 0 ? 7 : delta));
  d.setHours(hour, minute, 0, 0);
  return d;
}

/**
 * H-09 hero 倒數到下個週一 20:00
 *
 * 參考 HTML：`dd 日 hh:mm:ss`，每秒 tick。
 *
 * ✅ Hydration 安全：首次 render（server + client 第一次）一律輸出 `--` 佔位，
 * 真正嘅時間喺 mount 後嘅 effect 先計，所以 server / client 輸出完全一樣，
 * 唔會出現 hydration mismatch。
 *
 * 小時／分鐘由 `RULES.TRAINING_TIME` 帶入（而家係 20:00），
 * 改規則數字就會跟住改，唔使改元件。
 */
export function Countdown({ hour, minute }: { hour: number; minute: number }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const target = nextMondayAt(hour, minute, now);
      const total = Math.max(
        0,
        Math.floor((target.getTime() - now.getTime()) / 1000),
      );
      const dd = Math.floor(total / 86400);
      const hh = pad(Math.floor((total % 86400) / 3600));
      const mm = pad(Math.floor((total % 3600) / 60));
      const ss = pad(total % 60);
      setLabel(`${dd} 日 ${hh}:${mm}:${ss}`);
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [hour, minute]);

  return (
    <span className="fx-countdown" suppressHydrationWarning>
      {label ?? "--"}
    </span>
  );
}
