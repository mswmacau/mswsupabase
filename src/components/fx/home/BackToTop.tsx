"use client";

import { useEffect, useRef, useState } from "react";
import { useRafScroll } from "./useRafScroll";
import { prefersReducedMotion } from "./usePrefersReducedMotion";

/** 參考 HTML：`y>600` 先顯示 */
const SHOW_AT = 600;
/** 手機：停止捲動多久之後淡出（CSS 只喺 <=767px 生效，桌機不受影響） */
const IDLE_HIDE_MS = 2000;
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
  /**
   * 手機專用：停止捲動 2 秒後進入 idle（CSS 淡出＋不再接收點擊）。
   * 理由：390 寬度下按鈕常駐會壓住正文（實測遮住「核心訓練」47×24、
   * 「每公里 +1 積分」48×37）。滾動時立即回來，所以不會變成找不到的鈕。
   */
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringRef = useRef<SVGCircleElement>(null);

  useRafScroll(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const y = window.scrollY;
    // React 對同一個 boolean 會自動 bail out，唔會每幀 re-render
    setVisible(y > SHOW_AT);
    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_HIDE_MS);

    const ring = ringRef.current;
    if (!ring) return;
    const progress = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
    ring.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - progress));
  });

  // 卸載時清掉計時器，避免元件消失後仍然 setState
  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    []
  );

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
      data-fx-idle={idle ? "on" : "off"}
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
