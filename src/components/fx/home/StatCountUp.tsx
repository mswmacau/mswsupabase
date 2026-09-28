"use client";

import { useEffect, useRef, useState } from "react";
import { CountUp } from "@/components/fx/CountUp";
import { prefersReducedMotion } from "./usePrefersReducedMotion";

/** 參考 HTML：IO threshold .4、1400ms */
const THRESHOLD = 0.4;
const DURATION_MS = 1400;

/**
 * H-08 首頁數字 CountUp
 *
 * 直接複用 V8 既有嘅 `components/fx/CountUp.tsx`（唔重寫），
 * 只補兩樣嘢：
 *  1. 參考 HTML 嘅 IO threshold 係 .4，CountUp 內部用預設 0；
 *     呢度喺外層用自己嘅 IO（threshold .4）決定「幾時開始」，
 *     到時先 mount CountUp，門檻就同參考一致。
 *  2. CountUp 嘅 ease-out cubic `(1-(1-p)^3)` 同 1400ms 由 props 帶入。
 *
 * ✅ 失敗安全 + 文案凍結：
 *  - 未達門檻／JS 冇跑／開咗 reduced-motion → 輸出 `text`（即原本 server 算好嘅字串）
 *  - 終值由 `text` 反推（含小數點就 1 位，否則 0 位），
 *    所以動畫跑完顯示嘅字串同原本 `formatKm(...)`/`String(...)` 完全一致，
 *    唔會出現「動畫後數字同原本唔同」。
 */
export function StatCountUp({
  text,
  className,
}: {
  /** 原本要顯示嘅字串（例如 formatKm(stats.total_km) → "325.8"） */
  text: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [armed, setArmed] = useState(false);

  // 由字串反推數值與小數位，保證動畫終值 = 原字串
  const numeric = Number(text.replace(/[^0-9.-]/g, ""));
  const decimals: 0 | 1 = text.includes(".") ? 1 : 0;
  // 一定要先確認字串裡面真係有數字：Number("") === 0，
  // 單靠 Number.isFinite 會放「—」呢類純符號字串過關，然後顯示成「0」。
  const canAnimate = /\d/.test(text) && Number.isFinite(numeric);

  useEffect(() => {
    const node = hostRef.current;
    if (!node || !canAnimate) return;
    if (typeof IntersectionObserver === "undefined") return;
    if (prefersReducedMotion()) return;

    const io = new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.disconnect(); // 只數一次
          setArmed(true);
          return;
        }
      },
      { threshold: THRESHOLD },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [canAnimate]);

  return (
    <span ref={hostRef} className={className}>
      {armed ? (
        <CountUp value={numeric} decimals={decimals} durationMs={DURATION_MS} />
      ) : (
        text
      )}
    </span>
  );
}
