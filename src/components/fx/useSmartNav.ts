"use client";

import { useEffect, useState } from "react";

/** Brief §2.1 F-G1：向下碌超過 240px 先收起 */
const DEFAULT_THRESHOLD = 240;
/** 細過呢個位移當雜訊（手機橡皮筋回彈會不停微抖，唔理佢） */
const MIN_DELTA = 6;

/**
 * Smart nav：向下碌收起導覽列，向上碌或碌返頂部重現。
 *
 * - scroll listener 用 passive，再用 requestAnimationFrame 節流（一幀只計一次）
 * - prefers-reduced-motion 時完全唔裝 listener（hidden 恆為 false）
 * - 卸載時移除 listener 同 cancel 掉排緊嘅 frame
 *
 * @returns true = 收起（呼叫方自行加 -translate-y-full 之類嘅 class）
 */
export function useSmartNav(threshold: number = DEFAULT_THRESHOLD): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hidden, setHidden] = useState(false);

  // 系統設定可以中途改，所以要聽住 change
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    // reduced-motion 時唔裝 listener：由 return 值直接當做「冇收起」
    if (reducedMotion) return;

    let lastY = window.scrollY;
    let frame: number | null = null;

    const measure = () => {
      frame = null;
      const y = window.scrollY;

      // 接近頂部一律重現（Brief：碌到頂部重現）
      if (y <= threshold) {
        lastY = y;
        setHidden(false);
        return;
      }

      const delta = y - lastY;
      if (Math.abs(delta) < MIN_DELTA) return;
      lastY = y;
      setHidden(delta > 0);
    };

    const onScroll = () => {
      if (frame !== null) return; // 呢一幀已經排咗，唔使再排
      frame = window.requestAnimationFrame(measure);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [reducedMotion, threshold]);

  // prefers-reduced-motion：完全停用（hidden 一律當 false）
  return reducedMotion ? false : hidden;
}
