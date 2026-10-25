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
 * D 組「一次編排」：區塊群組（[data-fx-seq]）嘅安靜進場。
 *
 *  - 第二條 IO：threshold 0 + rootMargin 底部 -15%，
 *    即區塊頂部去到視野下方 85% 先至觸發（人到、先入場）。
 *  - 載入視窗延遲：一開站就喺視野內嘅群組（超高視野機，
 *    例如 1440×1200），要等 hero 序列收尾先至入場，
 *    先至維持到「hero 先出 → 統計列 → 內容區」嘅次序。
 */
const SEQ_ROOT_MARGIN = "0px 0px -15% 0px";
/** hero 序列 ≈ 0.48s 延遲 + 0.9s 時長 ≈ 1.38s 收尾；統計列等 0.9s 再出發，尾段稍微重疊屬預期編排 */
const SEQ_LOAD_DELAY_S = 0.9;
/** 開站後幾何內觸發都算「載入編排」（覆蓋 hero 序列全長） */
const LOAD_WINDOW_MS = 1600;

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
 *
 * D 組編排（兩條 IO、一次 arming）：
 *  1. [data-fx-reveal] —— hero 三級序列（h1 → 敘述 → CTA），36px／0.9s，
 *     開站即播，係全頁唯一嘅「難忘瞬間」。
 *  2. [data-fx-seq] —— 統計列 + 各內容區，18px／0.7s 安靜入場，
 *     捲到先播、依序（DOM 序 = 捲動序）播放，其餘一切安靜。
 */
export function RevealHome() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (prefersReducedMotion()) return;

    const root = document.documentElement;
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-fx-reveal]"),
    );
    const seqNodes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-fx-seq]"),
    );
    if (nodes.length === 0 && seqNodes.length === 0) return;

    const mountedAt = performance.now();
    const cleanups: Array<() => void> = [];

    root.classList.add(ARMED, ARMING);
    let frame: number | null = window.requestAnimationFrame(() => {
      frame = null;
      root.classList.remove(ARMING);
    });

    // IO 有冇成功回報過任何一次（用嚟判斷保險絲使唔使出手）
    let reported = false;
    /** 群組層（[data-fx-seq]）有冇回報過 */
    let reportedSeq = false;

    if (nodes.length > 0) {
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
        if (!reported) nodes.forEach((node) => node.classList.add("fx-in"));
      }, SAFETY_MS);

      cleanups.push(() => {
        window.clearTimeout(timer);
        io.disconnect();
      });
    }

    if (seqNodes.length > 0) {
      const seqIo = new IntersectionObserver(
        (entries, observer) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            reportedSeq = true;
            const el = entry.target as HTMLElement;
            // 開站視野內嘅群組：等 hero 序列收尾先出發（載入編排次序）；
            // 使用者捲到先至觸發嘅群組唔加延遲，避免「按下慢半拍」。
            if (performance.now() - mountedAt < LOAD_WINDOW_MS) {
              el.style.transitionDelay = `${SEQ_LOAD_DELAY_S}s`;
            }
            el.classList.add("fx-in");
            observer.unobserve(el); // 只入場一次
          }
        },
        { threshold: 0, rootMargin: SEQ_ROOT_MARGIN },
      );
      seqNodes.forEach((node) => seqIo.observe(node));

      const seqTimer = window.setTimeout(() => {
        if (!reportedSeq) {
          seqNodes.forEach((node) => node.classList.add("fx-in"));
        }
      }, SAFETY_MS);

      cleanups.push(() => {
        window.clearTimeout(seqTimer);
        seqIo.disconnect();
        seqNodes.forEach((node) => {
          node.style.transitionDelay = "";
        });
      });
    }

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      for (const fn of cleanups) fn();
      root.classList.remove(ARMED, ARMING);
      nodes.forEach((node) => node.classList.remove("fx-in"));
      seqNodes.forEach((node) => node.classList.remove("fx-in"));
    };
  }, []);

  return null;
}
