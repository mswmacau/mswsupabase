"use client";

/**
 * src/app/admin/_components/useIsDesktop.ts — 是否為桌面寬度（≥768px，對齊 Tailwind 的 md:）
 *
 * 為什麼需要它：/admin/content 與 /admin/analytics 的折疊區塊要「同一份 DOM 兼顧兩個寬度」，
 * 但兩邊的**預設展開狀態不同**（手機全收；桌面預設展開第一組 / 兩個最常看的區塊）。
 * 單靠 CSS（hidden md:block）做得到「預設展開」，卻做不到正確的 aria-expanded，
 * 而且一旦使用者手動收合，CSS 的預設值會被 state 蓋掉、兩者打架。
 * 所以預設值交給 JS 判斷，CSS 只負責「展開＝block／收起＝hidden」。
 *
 * 用 useSyncExternalStore 而非 useEffect + useState：
 *   · getServerSnapshot 固定回 false（＝手機），SSR 與第一次 hydration 輸出一致，
 *     不會出現 React #418 hydration mismatch（/admin/audit-log 踩過）。
 *   · hydration 後 React 會立刻用真實值重繪一次，不需要自己寫 setState 的 effect，
 *     也不會有多餘的一輪 paint。
 *
 * 注意：這支只在 client component 使用；首次 paint 前若寬度判定尚未生效，
 * 桌面會短暫看到「全收起」，重繪後即展開——這是刻意的取捨（換取正確的 aria 與
 * 使用者操作後的狀態不被斷點覆蓋）。
 */

import { useSyncExternalStore } from "react";

/** 與 Tailwind v4 預設 md 斷點一致（768px）；改這裡等於改兩個頁面的折疊分界 */
const QUERY = "(min-width: 768px)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

/** SSR 與 hydration 第一次 render 一律視為手機（與伺服器輸出一致） */
function getServerSnapshot(): boolean {
  return false;
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
