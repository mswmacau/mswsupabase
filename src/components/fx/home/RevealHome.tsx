"use client";

import { useEffect } from "react";
import { prefersReducedMotion } from "./usePrefersReducedMotion";

/** 呢兩個 class 由 JS 喺 mount 後先加到 <html>，未加之前內容一律 100% 可見 */
const ARMED = "fx-reveal-armed";
/** 加 ARMED 嗰一幀先塞呢個 class，用嚟唔好「淡出再淡入」（見下面註解） */
const ARMING = "fx-reveal-arming";
/**
 * 兜底：只喺 IntersectionObserver **完全冇回報過**（即 IO 失效）時先無條件顯示。
 * 注意：參考 HTML 第 476–479 行嘅 reveal IO 本身係冇保險絲嘅
 * （1600ms 兜底只屬於 CountUp）。所以呢條保險絲嘅職責要收窄到
 * 「IO 壞咗」呢一種情況，唔可以變成「2.5 秒後全部顯示」，
 * 否則未入過視野嘅元素會提早變成顯示態，H-03 就唔會再播。
 */
const SAFETY_MS = 2500;

/**
 * H-03 reveal 進場（JS 版）
 *
 * 參考 HTML：IntersectionObserver threshold .12 → 加 `.on`，
 * `opacity 0→1` + `translateY(36px)→0`，0.9s cubic-bezier(.2,.6,.2,1)，
 * 交錯延遲由 `--d` 控制。
 *
 * ⚠️ 同 V8 現有 CSS-only reveal（`@supports (animation-timeline: view())`）嘅分別：
 * V8 嗰組只喺支援 scroll-driven animation 嘅瀏覽器先生效，Safari／Firefox 舊版
 * 完全冇進場動畫，而且 keyframes 入面 opacity 恆為 1（所以其實只係位移）。
 * 呢度改用 JS + IO，任何瀏覽器都有一致節奏。
 *
 * ✅ 失敗安全（硬要求）：初始態永遠係「完全可見」。只有當 JS 成功 mount、
 * 而且瀏覽器有 IntersectionObserver、而且使用者冇開 reduced-motion，
 * 先會喺 <html> 加 `fx-reveal-armed` 去落初始隱藏態。
 * JS 冇跑／報錯／舊瀏覽器 → class 永遠唔會出現 → 內容原樣完整可讀。
 *
 * 另一個細節：加 ARMED 嗰一幀同時加 ARMING（transition:none），
 * 否則元素會由「可見」用 0.9s 慢慢淡出再淡入，變成一次多餘嘅抖動。
 * 下一幀先移除 ARMING，之後 IO 加 `.fx-in` 就會正常播進場動畫。
 */
export function RevealHome() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (prefersReducedMotion()) return;

    const root = document.documentElement;
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-fx-reveal]"),
    );
    if (nodes.length === 0) return;

    root.classList.add(ARMED, ARMING);
    let frame: number | null = window.requestAnimationFrame(() => {
      frame = null;
      root.classList.remove(ARMING);
    });

    // IO 有冇成功回報過任何一次（用嚟判斷保險絲使唔使出手）
    let reported = false;

    const io = new IntersectionObserver(
      (entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reported = true;
          entry.target.classList.add("fx-in");
          observer.unobserve(entry.target); // 只入場一次
        }
      },
      { threshold: 0.12 },
    );
    nodes.forEach((node) => io.observe(node));

    // 兜底保險絲：只喺 IO 完全冇回報過（IO 失效）時先插手；
    // IO 正常運作嘅話，未入視野嘅元素要繼續等，否則 H-03 唔會播。
    const timer = window.setTimeout(() => {
      if (reported) return;
      nodes.forEach((node) => node.classList.add("fx-in"));
    }, SAFETY_MS);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      io.disconnect();
      root.classList.remove(ARMED, ARMING);
      nodes.forEach((node) => node.classList.remove("fx-in"));
    };
  }, []);

  return null;
}
