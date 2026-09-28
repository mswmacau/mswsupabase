"use client";

import { useEffect, useRef, useState } from "react";

/** Brief §2.1 F-G2：1.2 秒 ease-out */
const DEFAULT_DURATION_MS = 1200;

/**
 * 預設顯示規則同 formatKm 一致：整數唔補小數位，其餘保留一位小數。
 * 數字本身一律由頁面由 config / DB 傳入，元件內唔產生任何數值。
 */
function defaultFormat(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export interface CountUpProps {
  /** 終值（由頁面傳入） */
  value: number;
  /**
   * 顯示格式。注意：只有 client component 先可以傳 function prop
   * （server component 傳 function 過唔到 serialization）。
   * server parent 請用 `decimals`。
   */
  format?: (n: number) => string;
  /** 固定小數位數（可序列化版嘅 format） */
  decimals?: 0 | 1;
  /** 動畫時長（毫秒），預設 1200 */
  durationMs?: number;
  className?: string;
}

/**
 * 碌到可見先由 0 數上去，只數一次。
 *
 * Hydration 安全：初始 render（server + client 第一次）輸出嘅係終值，
 * 所以關掉 JS 或者未 hydrate 都睇到正確數字；動畫一定要喺 useEffect（mount 後）
 * 先開始，避免 server / client 輸出唔同。
 *
 * prefers-reduced-motion：直接顯示終值，完全唔跑動畫。
 */
export function CountUp({
  value,
  format,
  decimals,
  durationMs = DEFAULT_DURATION_MS,
  className,
}: CountUpProps) {
  const target = Number.isFinite(value) ? value : 0;

  const makeFormat = () =>
    format ?? (decimals === undefined ? defaultFormat : (n: number) => n.toFixed(decimals));

  // 初始值 = 終值（SSR 與首次 hydration 完全一致）
  const [display, setDisplay] = useState(() => makeFormat()(target));
  const hostRef = useRef<HTMLSpanElement>(null);
  const formatRef = useRef(format);
  const decimalsRef = useRef(decimals);

  useEffect(() => {
    formatRef.current = format;
    decimalsRef.current = decimals;
  }, [format, decimals]);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;

    const fmt = () =>
      formatRef.current ??
      (decimalsRef.current === undefined
        ? defaultFormat
        : (n: number) => n.toFixed(decimalsRef.current as number));

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (
      reducedMotion.matches ||
      typeof IntersectionObserver === "undefined" ||
      durationMs <= 0
    ) {
      setDisplay(fmt()(target));
      return;
    }

    let raf = 0;
    let startedAt = 0;

    const step = (now: number) => {
      if (!startedAt) startedAt = now;
      const t = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(fmt()(target * eased));
      if (t < 1) raf = requestAnimationFrame(step);
      else raf = 0;
    };

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.disconnect(); // 只觸發一次
        // 起點歸零先開始：未入過視野嘅數字會一直保持終值（SSR 出來嗰個）
        setDisplay(fmt()(0));
        raf = requestAnimationFrame(step);
        return;
      }
    });
    io.observe(node);

    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [target, durationMs]);

  return (
    <span ref={hostRef} className={className}>
      {display}
    </span>
  );
}
