"use client";

import { useEffect, useRef } from "react";
import { useRafScroll } from "./useRafScroll";
import { prefersReducedMotion } from "./usePrefersReducedMotion";

/** 參考 HTML：`#scrub .w{opacity:.13}`（未點亮嘅字） */
const DIM_OPACITY = "0.13";

/**
 * H-13 逐字點亮 scrub
 *
 * 參考 HTML：把 statement 拆成逐字 `<span class="w">`，
 * `p = (innerHeight*0.85 - rect.top) / (innerHeight*0.65)`，
 * 依進度把前 n 個字設成 opacity 1，其餘維持 .13。
 *
 * ✅ 失敗安全：逐字 span 係 server 端就 render 出嚟（SSR HTML 有齊全部字），
 * 初始 opacity 係 1；只有 JS mount 成功先會加 `fx-scrub-armed` 轉暗。
 * JS 冇跑 → 全部字維持 100% 可讀（呢點同參考 HTML 唔同，參考係 CSS 直接寫死 .13）。
 *
 * 無障礙：逐字 span 會令螢幕閱讀器逐個字讀，所以另外出一份
 * `.fx-sr-only` 原文，逐字嗰份標 `aria-hidden`。
 */
export function ScrubText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const words = Array.from(
      host.querySelectorAll<HTMLElement>("[data-fx-w]"),
    );
    if (words.length === 0) return;
    if (prefersReducedMotion()) return;

    host.classList.add("fx-scrub-armed");
    return () => {
      host.classList.remove("fx-scrub-armed");
      words.forEach((w) => {
        w.style.opacity = "";
      });
    };
  }, [text]);

  useRafScroll(() => {
    const host = hostRef.current;
    if (!host || !host.classList.contains("fx-scrub-armed")) return;
    const words = Array.from(
      host.querySelectorAll<HTMLElement>("[data-fx-w]"),
    );
    if (words.length === 0) return;

    const rect = host.getBoundingClientRect();
    const p = Math.min(
      1,
      Math.max(
        0,
        (window.innerHeight * 0.85 - rect.top) / (window.innerHeight * 0.65),
      ),
    );
    // 用 ceil：參考 HTML 第 530 行係 `i/words.length < p`（i 由 0 起），
    // 等價於點亮 ceil(p × len) 個字；用 floor 會少點亮 1 個。
    const lit = Math.ceil(p * words.length);
    for (let i = 0; i < words.length; i += 1) {
      const w = words[i];
      if (!w) continue; // 唔用 words[i].style，避免 unchecked index access
      w.style.opacity = i < lit ? "1" : DIM_OPACITY;
    }
  });

  return (
    <span className={className}>
      <span className="fx-sr-only">{text}</span>
      <span ref={hostRef} className="fx-scrub" aria-hidden>
        {Array.from(text).map((ch, i) => (
          // eslint-disable-next-line react/no-array-index-key -- 逐字 span 位置固定，index 就係穩定 key
          <span key={i} data-fx-w>
            {ch === " " ? "\u00A0" : ch}
          </span>
        ))}
      </span>
    </span>
  );
}
