"use client";

import { useEffect } from "react";
import { hasHover, prefersReducedMotion } from "./usePrefersReducedMotion";

/** 參考 HTML：ring 用 lerp 0.18 緩隨 */
const LERP = 0.18;
/** hover 呢幾類元素時 ring 放大（參考 HTML：`a,button,.prog,.hcard`） */
const BIG_SELECTOR = "a,button,[data-fx-tilt],[data-fx-magnet]";

/**
 * H-16 自訂游標 dot + ring
 *
 * 參考 HTML：`body.has-cursor` + `#cdot`（直接跟隨）+ `#cring`（lerp .18 緩隨）。
 *
 * 只喺 `matchMedia('(hover:hover)')` 成立、而且冇開 reduced-motion 時啟用，
 * 觸控裝置完全唔會建立任何 DOM／listener（CSS 亦有 `@media(hover:none)` 兜底）。
 *
 * dot／ring 由 JS 動態 createElement，唔佔 SSR HTML：
 * 冇 JS 就唔會有游標元素，亦唔會出現「游標唔見咗」嘅情況。
 */
export function CursorFx() {
  useEffect(() => {
    if (!hasHover() || prefersReducedMotion()) return;

    const dot = document.createElement("div");
    dot.className = "fx-cdot";
    dot.setAttribute("aria-hidden", "true");
    const ring = document.createElement("div");
    ring.className = "fx-cring";
    ring.setAttribute("aria-hidden", "true");
    document.body.appendChild(dot);
    document.body.appendChild(ring);

    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let rx = mx;
    let ry = my;

    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
      dot.style.transform = `translate3d(${mx}px, ${my}px, 0)`;
    };

    let raf = 0;
    const loop = () => {
      rx += (mx - rx) * LERP;
      ry += (my - ry) * LERP;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);

    // 用事件委派：元素係 React render 出嚟嘅，隨時會增減
    const onOver = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const hit = target.closest(BIG_SELECTOR);
      ring.classList.toggle("big", Boolean(hit));
    };

    document.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseover", onOver, { passive: true });

    // 一定要喺 listener + rAF 都註冊好之後先加呢個 class（= cursor:none）：
    // 否則中途拋錯嘅話 cleanup 都未註冊，會變「游標消失但唔會郁」。
    document.body.classList.add("fx-has-cursor");

    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseover", onOver);
      document.body.classList.remove("fx-has-cursor");
      dot.remove();
      ring.remove();
    };
  }, []);

  return null;
}
