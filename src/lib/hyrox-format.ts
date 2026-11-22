/**
 * src/lib/hyrox-format.ts — 完賽時間格式化（server 與 client 共用）
 *
 * 【為什麼要獨立成一支】
 * 原本 `formatFinish` 定義在 `"use client"` 的
 * `src/components/hyrox/MyHyroxResults.tsx` 並 export，而 Server Component
 * `/hyrox/results/page.tsx` 直接呼叫它。Next.js 會拋：
 *   「Attempted to call formatFinish() from the server but formatFinish is
 *     on the client.」
 * 這個錯誤**只在榜上有資料時才觸發**（空榜時 map 不執行、函式不被呼叫），
 * 所以 migration 未跑的空狀態測試完全測不出來，一有第一筆已核可成績就整頁白。
 * 2026-11-22 由實測抓到並修復：把純函式移到無 "use client" 的模組。
 *
 * 任何「純格式化、無 hooks、無瀏覽器 API」的共用函式都應放在這種模組，
 * 不要放在 client component 檔裡再給 server 用。
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 秒 → HH:MM:SS（榜的顯示格式；server 與 client 同一演算法） */
export function formatFinish(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad2(Math.floor(s / 3600))}:${pad2(
    Math.floor((s % 3600) / 60)
  )}:${pad2(s % 60)}`;
}
