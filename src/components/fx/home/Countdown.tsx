"use client";

import { useEffect, useState } from "react";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * H-09 hero 倒數：倒數到「下一場定期訓練的開始時刻」。
 *
 * 舊版寫死「下一個週一 hour:minute」，與真實班表脫鉤（場次明明在週六 19:00，
 * 倒數卻在數週一 20:00）。現在改由呼叫端傳入絕對時刻（帶 +08:00 偏移的 ISO
 * 字串，例如 2026-11-14T19:00:00+08:00），倒數才會對準真正的那一場，
 * 而且瀏覽器在任何時區算出來都是同一個瞬間。
 *
 * ✅ Hydration 安全：首次 render（server + client 第一次）一律輸出 `--` 佔位，
 * 真正嘅時間喺 mount 後嘅 effect 先計，所以 server / client 輸出完全一樣，
 * 唔會出現 hydration mismatch。
 */
export function Countdown({ targetISO }: { targetISO: string }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const target = new Date(targetISO).getTime();
    // 目標時刻解析失敗就維持 "--"，不要算出 NaN 貼到畫面上
    if (!Number.isFinite(target)) return;

    const tick = () => {
      const now = Date.now();
      const total = Math.max(0, Math.floor((target - now) / 1000));
      const dd = Math.floor(total / 86400);
      const hh = pad(Math.floor((total % 86400) / 3600));
      const mm = pad(Math.floor((total % 3600) / 60));
      const ss = pad(total % 60);
      setLabel(`${dd} 日 ${hh}:${mm}:${ss}`);
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    // cleanup：unmount 後 interval 必須清掉
    return () => window.clearInterval(timer);
  }, [targetISO]);

  return (
    <span className="fx-countdown" suppressHydrationWarning>
      {label ?? "--"}
    </span>
  );
}
