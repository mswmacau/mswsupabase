"use client";

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * 讀取系統「減少動態效果」設定，並監聽中途變更。
 *
 * 注意：初始值一律係 false（SSR 同首次 hydration 一致），
 * 真正嘅值喺 mount 後嘅 effect 先讀。需要喺 effect 裡面判斷嘅元件，
 * 請直接用 window.matchMedia(QUERY).matches（嗰陣已經一定有 window），
 * 唔好靠呢個 state，否則會慢一拍。
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return reduced;
}

/** effect 內用：即時讀一次（唔使等 state） */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

/** 只喺真正有指標裝置（滑鼠／觸控筆）時先開嘅效果用 */
export function hasHover(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(hover: hover)").matches;
}
