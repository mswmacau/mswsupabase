/**
 * src/components/motion/motionConfig.ts — 動效集中設定（motion 邊界）
 *
 * Owner：方砚。對齊《MSW-動效套用-分析與任務清單》§5 設計參數與 T-2 / T-13。
 *
 * ⚠️ 邊界（任析拍板，不得擴權）：
 *   - 只有「React 生命週期相關」的效果先用 motion：E10 AnimatePresence、
 *     E11 layoutId、E12 popLayout。
 *   - 純滾動 / 純 hover 一律沿用官網自研零依賴做法（E05 useRafScroll、E08 CSS）。
 *   - 本檔只會被 `/events`、`/training` 兩個路由嘅 client component import，
 *     靠 App Router route-level code split 保證首頁 bundle 增量為 0（紅線 5 / R3）。
 *   - 本檔唔可以畀 `src/app/page.tsx`、`src/app/layout.tsx` 直接或間接 import。
 */

import type { Transition } from "motion/react";

/**
 * 集中開關（T-13 / 緊急回滾 L1）—— 由環境變數控制，**預設開啟**。
 *
 * 設為 `false` 時：所有 motion 效果退化為靜態渲染 ——
 * 唔會寫入任何 `initial` 隱藏態、唔會做 layout 量測、唔會播進退場，
 * 功能與內容 100% 維持原樣，客戶唔使刪檔就可以停用動效。
 *
 * ── 點解用 `NEXT_PUBLIC_` 前綴 ────────────────────────────────
 * Next.js 規定：只有 `NEXT_PUBLIC_*` 會喺 **建置期（build time）** 被
 * 靜態內聯（inline）入 client bundle（webpack / Turbopack 嘅 DefinePlugin
 * 等價機制）。呢三個用到佢嘅檔案全部都係 `"use client"`，一定要行呢條路，
 *  client 先讀得到值。
 *
 * 所以 Vercel 上嘅緊急回退流程係：
 *   後台 Settings → Environment Variables 改 `NEXT_PUBLIC_MOTION_ENABLED=false`
 *   → Deployments → Redeploy（勾選清除 Build Cache 更穩）→ 新 build 內聯新值
 *   → 生效。**全程唔使改任何一行程式碼**，符合 L1 緊急開關嘅設計意圖。
 *
 * ⚠️ 代價（要同客戶講清楚）：因為係建置期內聯，所以**一定要重新 build**。
 *   單改 env 但沿用舊 build artifact（例如 Vercel 嘅 Promote to Production）
 *   係唔會生效嘅。呢個係 `NEXT_PUBLIC_` 嘅先天限制，唔係實作 bug。
 *
 * ── 取值規則 ────────────────────────────────────────────────
 * 只認明確嘅「關閉」值，其餘一律視為【開啟】——確保冇設、設錯字、
 * 或者喺後台清成空值嗰陣，線上動效都唔會無啦啦消失（紅線：預設必須開）。
 *   - 未設定 / 空值 / 任何其他字串 → `true`
 *   - `false` / `0` / `off` / `no`（唔分大小寫，前後空白會被忽略）→ `false`
 */
const MOTION_ENV = (process.env.NEXT_PUBLIC_MOTION_ENABLED ?? "")
  .trim()
  .toLowerCase();

export const MOTION_ENABLED =
  MOTION_ENV !== "false" &&
  MOTION_ENV !== "0" &&
  MOTION_ENV !== "off" &&
  MOTION_ENV !== "no";

/**
 * 品牌緩動：與 globals.css 嘅 `--ease-msw` / `.fx-weight-card`
 * （cubic-bezier(0.2, 0.7, 0.2, 1)）同一條手感 —— 硬朗、街健、重量感。
 */
export const EASE_MSW: [number, number, number, number] = [0.2, 0.6, 0.2, 1];

/** E10 列表／月曆切換：進場 0.22s、退場 0.16s（mode="wait" 總和 ≤ 0.4s） */
export const T_VIEW_IN: Transition = { duration: 0.22, ease: EASE_MSW };
export const T_VIEW_OUT: Transition = { duration: 0.16, ease: EASE_MSW };
/** E10 位移量（px）—— 只動 transform，唔動 width/height/top/left */
export const VIEW_SHIFT = 14;

/**
 * E11 chips 高亮滑動：高 stiffness + 高 damping ＝ 硬朗、唔晃（E15 結論）。
 */
export const T_CHIP: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 38,
  mass: 0.7,
};

/** E12 卡片進／退場：唔含 spring（網格補位用 spring 會晃） */
export const T_CARD_IN: Transition = { duration: 0.24, ease: EASE_MSW };
export const T_CARD_OUT: Transition = { duration: 0.18, ease: EASE_MSW };
/** E12 位移量（px） */
export const CARD_SHIFT = 12;
