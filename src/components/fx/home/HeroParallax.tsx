"use client";

/**
 * src/components/fx/home/HeroParallax.tsx — E05 首頁 Hero 背景圖單層視差
 *
 * Owner：方砚。對齊《MSW-動效套用-分析與任務清單》T-8：
 *  - 三層視差降級為**單層**（官網無三層圖層嘅區塊，得 Hero 一張背景圖）
 *  - **唔用 motion**（純滾動驅動），沿用 `fx/home/useRafScroll.ts` 嘅
 *    「1 個 passive listener + 1 條 rAF 鏈 + N 個 callback」，
 *    **唔新增任何 scroll listener、唔新增第二條 rAF 鏈**（紅線 12）
 *  - reduced-motion 完全靜止（`prefersReducedMotion()`）
 *  - 零依賴：首頁 bundle 唔會因本任務增加任何嘢
 *
 * ✅ 失敗安全（鐵則，對照 home-fx.css 8–11 行、DriftWord.tsx 16–18 行）：
 *    靜止態就係背景圖原本嘅位置（無 transform）。JS 冇跑／報錯 →
 *    背景圖維持 100% 可見、停喺靜態位置，唔會遮住任何內容。
 *
 * 位移量（§5）：桌面 ±5%，移動端減半（window.innerWidth < 768）。
 * 只寫 `translate3d(0, y, 0)` —— 淨動 transform，唔動 width/height/top/left/margin。
 */

import { useRef, type ReactNode } from "react";
import { useRafScroll } from "./useRafScroll";
import { prefersReducedMotion } from "./usePrefersReducedMotion";

/** 桌面位移幅度（佔 Hero 高度） */
const DESKTOP_AMP = 0.05;
/** 移動端減半（澳門移動端優先，減低 iOS Safari repaint 成本） */
const MOBILE_AMP = 0.025;
const MOBILE_BREAKPOINT = 768;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * @param children Hero 背景圖嗰一層（由 page.tsx 以 server-rendered element 傳入）
 */
export function HeroParallax({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useRafScroll(() => {
    const el = ref.current;
    if (!el) return;

    // 區塊離開視野：唔再寫 transform，並移除 will-change（紅線 13）
    const scope = document.querySelector<HTMLElement>("[data-fx-hero]");
    if (!scope) return;

    const sr = scope.getBoundingClientRect();
    const offscreen = sr.top >= window.innerHeight || sr.bottom <= 0;

    if (offscreen || prefersReducedMotion()) {
      if (el.style.willChange) el.style.willChange = "";
      if (prefersReducedMotion() && el.style.transform) {
        el.style.transform = "";
      }
      return;
    }

    const amp = window.innerWidth < MOBILE_BREAKPOINT ? MOBILE_AMP : DESKTOP_AMP;
    // 0 = Hero 頂部對齊視窗頂；1 = Hero 完全捲出畫面
    const progress = clamp01(-sr.top / Math.max(sr.height, 1));

    el.style.willChange = "transform";
    el.style.transform = `translate3d(0, ${(progress * amp * sr.height).toFixed(2)}px, 0)`;
  });

  return (
    <div ref={ref} className="fx-hero-parallax" aria-hidden>
      {children}
    </div>
  );
}
