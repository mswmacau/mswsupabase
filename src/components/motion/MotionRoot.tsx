"use client";

/**
 * src/components/motion/MotionRoot.tsx — motion 邊界元件（T-3）
 *
 * Owner：方砚。兩件事：
 *
 * 1) 統一 reduced-motion 入口。
 *    自研那一側嘅單一來源係 `src/components/fx/home/usePrefersReducedMotion.ts`
 *    （`usePrefersReducedMotion()` / `prefersReducedMotion()` / `hasHover()`），
 *    已被 6 個 fx 元件引用，本階段「唔新增第二個 hook」。
 *    motion 這一側統一由 `<MotionConfig reducedMotion="user">` 處理 ——
 *    佢讀嘅係同一條 media query `(prefers-reduced-motion: reduce)`，
 *    所以兩邊行為一致，而且中途切換系統設定會即時跟住變（唔使重整）。
 *
 *    ⚠️ 點解一定要喺 JS 層做：globals.css 750 行起嘅
 *    `@media (prefers-reduced-motion: reduce) { * { transition-duration: .01ms !important } }`
 *    對 motion 完全無效（motion 行 JS / Web Animations API，唔行 CSS transition）。
 *
 * 2) SSR 安全閘（R1 / 紅線 10）。
 *    motion 嘅 `initial={{ opacity: 0 }}` 喺 SSR 階段會直接寫入 inline style，
 *    JS 一失敗內容就永久隱形，違反官網「無 JS 時內容 100% 可見」鐵則。
 *    所以 `useMotionReady()` 喺 SSR 同首次 hydration 一律回傳 false，
 *    動效元件據此用 `initial={false}`（＝直接 render `animate` 嘅可見態）；
 *    只有 mount 成功之後新掛載嘅子元素先用隱藏態做進場。
 */

import { useSyncExternalStore, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { MOTION_ENABLED } from "./motionConfig";

/**
 * 所有用到 motion 嘅元件都必須被包住（events / training 兩個路由嘅
 * client component 內層包一層即可）。佢唔會 render 任何 DOM。
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/**
 * SSR / hydration 安全閘。
 *
 * - SSR 與首次 client render：`false` → 動效元件用 `initial={false}`，
 *   SSR HTML 只會出現「完全可見」嘅 `animate` 值（opacity:1、無位移）。
 * - mount 之後嘅 effect：`true` → 之後新掛載嘅子元素先播進場。
 * - `MOTION_ENABLED === false`：永遠 `false` → 全程靜態渲染（T-13 開關）。
 */
/**
 * 唔用 `useState + useEffect`：喺 effect 入面同步 setState 會觸發連鎖 render
 * （eslint react-hooks/set-state-in-effect）。呢度用 `useSyncExternalStore`
 * —— getServerSnapshot 永遠係 false、getSnapshot 永遠係 true，
 * React 自己喺 hydration 之後切過去，語意完全一樣而且零連鎖 render。
 */
const subscribeNoop = () => () => {};

export function useMotionReady(): boolean {
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    () => true, // client
    () => false, // SSR / 首次 hydration
  );

  return MOTION_ENABLED && hydrated;
}
