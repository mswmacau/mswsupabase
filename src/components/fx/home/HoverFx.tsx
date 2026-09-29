"use client";

import { useEffect } from "react";
import { hasHover, prefersReducedMotion } from "./usePrefersReducedMotion";

/** 參考 HTML：磁吸 `translate(x*.16, y*.26)` */
const MAGNET_X = 0.16;
const MAGNET_Y = 0.26;
/** 參考 HTML：tilt `perspective(900px) rotateY(x*7deg) rotateX(-y*7deg) translateY(-6px)` */
const TILT_DEG = 7;
const TILT_LIFT = 6;

/**
 * H-11 按鈕磁吸 + H-12 卡片 3D tilt
 *
 * 兩者都只睇 data attribute（`[data-fx-magnet]` / `[data-fx-tilt]`），
 * 頁面想喺邊度開就喺邊度加 attribute，唔使改呢個元件。
 *
 * 只喺 `(hover:hover)` 且冇 reduced-motion 時啟用；mouseleave 一律歸零
 * （清走 inline transform，交返畀 CSS hover 樣式）。
 */
export function HoverFx() {
  useEffect(() => {
    if (!hasHover() || prefersReducedMotion()) return;

    const cleanups: Array<() => void> = [];

    document.querySelectorAll<HTMLElement>("[data-fx-magnet]").forEach((el) => {
      const onMove = (e: MouseEvent) => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - r.left - r.width / 2) * MAGNET_X;
        const dy = (e.clientY - r.top - r.height / 2) * MAGNET_Y;
        el.style.transform = `translate(${dx}px, ${dy}px)`;
      };
      const onLeave = () => {
        el.style.transform = "";
      };
      el.addEventListener("mousemove", onMove, { passive: true });
      el.addEventListener("mouseleave", onLeave);
      cleanups.push(() => {
        el.removeEventListener("mousemove", onMove);
        el.removeEventListener("mouseleave", onLeave);
        el.style.transform = "";
      });
    });

    document.querySelectorAll<HTMLElement>("[data-fx-tilt]").forEach((el) => {
      // 同一個元素若同時有 data-fx-reveal，reveal 嗰條 0.9s transform transition
      // 特異性較高，會令 tilt 慢半拍。所以喺第一次 hover 先至用 inline transition
      // 覆蓋（inline 一定贏），進場動畫本身仍然用返 0.9s。
      let touched = false;
      const prevTransition = el.style.transition;

      const onMove = (e: MouseEvent) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        if (!touched) {
          touched = true;
          el.style.transition =
            "transform 0.35s var(--ease-msw), border-color 0.35s ease, background-color 0.35s ease";
        }
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `perspective(900px) rotateY(${x * TILT_DEG}deg) rotateX(${
          -y * TILT_DEG
        }deg) translateY(-${TILT_LIFT}px)`;
      };
      const onLeave = () => {
        el.style.transform = "";
      };
      el.addEventListener("mousemove", onMove, { passive: true });
      el.addEventListener("mouseleave", onLeave);
      cleanups.push(() => {
        el.removeEventListener("mousemove", onMove);
        el.removeEventListener("mouseleave", onLeave);
        el.style.transform = "";
        el.style.transition = prevTransition;
      });
    });

    return () => {
      for (const fn of cleanups) fn();
    };
  }, []);

  return null;
}
