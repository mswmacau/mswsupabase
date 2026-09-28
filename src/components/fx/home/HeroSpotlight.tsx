"use client";

import { useEffect } from "react";
import { prefersReducedMotion } from "./usePrefersReducedMotion";

/** 滑鼠離開 hero 後退回嘅預設光點位置（參考 HTML 嘅初始值 72% / 22%） */
const DEFAULT_X = "72%";
const DEFAULT_Y = "22%";

/**
 * H-17 hero 滑鼠聚光燈
 *
 * 參考 HTML：喺 `.hero` 上設 `--mx`/`--my`（百分比），
 * CSS `radial-gradient` 跟住滑鼠行，形成移動光暈。
 *
 * ✅ 失敗安全：CSS 用 `var(--fx-mx, 72%)`，JS 冇跑就係一舊固定嘅靜態光暈，
 * 版面同可讀性完全唔受影響。
 */
export function HeroSpotlight() {
  useEffect(() => {
    const hero = document.querySelector<HTMLElement>("[data-fx-hero]");
    if (!hero) return;
    if (prefersReducedMotion()) return;

    const onMove = (e: MouseEvent) => {
      const r = hero.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      hero.style.setProperty(
        "--fx-mx",
        `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`,
      );
      hero.style.setProperty(
        "--fx-my",
        `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`,
      );
    };

    const onLeave = () => {
      hero.style.setProperty("--fx-mx", DEFAULT_X);
      hero.style.setProperty("--fx-my", DEFAULT_Y);
    };

    hero.addEventListener("mousemove", onMove, { passive: true });
    hero.addEventListener("mouseleave", onLeave);

    return () => {
      hero.removeEventListener("mousemove", onMove);
      hero.removeEventListener("mouseleave", onLeave);
      hero.style.removeProperty("--fx-mx");
      hero.style.removeProperty("--fx-my");
    };
  }, []);

  return null;
}
