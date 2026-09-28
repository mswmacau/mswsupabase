"use client";

import { useRef, useState } from "react";
import { useRafScroll } from "./useRafScroll";
import { prefersReducedMotion } from "./usePrefersReducedMotion";

/** 參考 HTML：`y>600` 先顯示 */
const SHOW_AT = 600;
/** 環形進度：r = 19 → 2πr ≈ 119.4（同參考 HTML 嘅 stroke-dasharray 一致） */
const CIRCUMFERENCE = 119.4;

/**
 * H-19 回頂部鈕 + 環形閱讀進度
 *
 * 參考 HTML：`topBtn.style.display = y>600?'flex':'none'`、
 * `topRing.strokeDashoffset = 119.4*(1-progress)`
 *
 * 呢度改用 data-fx-top="on|off" + CSS 控制顯示（SSR 固定輸出 off，
 * 所以關掉 JS 時鈕會一直隱形，唔會出現「冇 JS 嘅死鈕」）。
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);
  const ringRef = useRef<SVGCircleElement>(null);

  useRafScroll(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const y = window.scrollY;
    // React 對同一個 boolean 會自動 bail out，唔會每幀 re-render
    setVisible(y > SHOW_AT);

    const ring = ringRef.current;
    if (!ring) return;
    const progress = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
    ring.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - progress));
  });

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };

  return (
    <button
      type="button"
      aria-label="返回頂部"
      data-fx-top={visible ? "on" : "off"}
      className="fx-top"
      onClick={scrollToTop}
    >
      <svg viewBox="0 0 44 44" aria-hidden>
        <circle
          cx="22"
          cy="22"
          r="19"
          fill="none"
          stroke="color-mix(in srgb, var(--color-white) 15%, transparent)"
          strokeWidth="3"
        />
        <circle
          ref={ringRef}
          cx="22"
          cy="22"
          r="19"
          fill="none"
          stroke="var(--color-vital-bright)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE}
          transform="rotate(-90 22 22)"
        />
      </svg>
      <span aria-hidden>↑</span>
    </button>
  );
}
