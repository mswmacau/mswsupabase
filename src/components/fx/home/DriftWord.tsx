"use client";

import { useRef } from "react";
import { useRafScroll } from "./useRafScroll";
import { prefersReducedMotion } from "./usePrefersReducedMotion";

/** 參考 HTML：`translate(${-sr.top*0.22}px, -50%)` */
const DRIFT_RATIO = 0.22;

/**
 * H-15 背景漂移大字
 *
 * 只喺所屬區塊（[data-fx-drift-scope]）進入視野時先計，
 * 區塊離開視野就唔再寫 transform（慳返無謂嘅 style 寫入）。
 *
 * ✅ 失敗安全：靜止態係 `translate3d(0,-50%,0)`，
 * JS 冇跑就係一舊固定嘅描邊大字，唔會遮住內容（z-index:0 + pointer-events:none）。
 */
export function DriftWord({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useRafScroll(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return;

    const scope = document.querySelector<HTMLElement>("[data-fx-drift-scope]");
    if (!scope) return;

    const sr = scope.getBoundingClientRect();
    if (sr.top >= window.innerHeight || sr.bottom <= 0) return;
    el.style.transform = `translate3d(${-sr.top * DRIFT_RATIO}px, -50%, 0)`;
  });

  return (
    <div ref={ref} className="fx-drift" data-fx-drift aria-hidden>
      {text}
    </div>
  );
}
