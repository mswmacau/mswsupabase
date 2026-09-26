"use client";

/**
 * src/components/NavProgress.tsx — 全域導航頂部進度條（需求 C：loading 體感）
 *
 * 演算法（SPEC-R6.md §3.5，禁止使用已移除的 router.events）：
 *  1. capture 階段監聽 document 的 click：點到同源 a[href^="/"] → 開始動畫（0→85%，300ms）
 *  2. usePathname()/useSearchParams() 變化 → 補滿 100% 後淡出
 *  3. 4 秒保險：若 pathname 未變化也自動淡出，避免卡死假進度條
 *  4. 元件卸載移除監聽
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const COMPLETE_DELAY = 150; // 補滿後等待再淡出
const FADE_MS = 300;
const SAFETY_MS = 4000;

export function NavProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [active, setActive] = useState(false);
  const [width, setWidth] = useState(0);
  const [fade, setFade] = useState(false);

  const startedRef = useRef(false);
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (safetyRef.current) clearTimeout(safetyRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    safetyRef.current = null;
    fadeTimerRef.current = null;
  }

  const complete = useCallback(() => {
    startedRef.current = false;
    clearTimers();
    setWidth(100);
    fadeTimerRef.current = setTimeout(() => {
      setFade(true);
      fadeTimerRef.current = setTimeout(() => {
        setActive(false);
        setWidth(0);
        setFade(false);
      }, FADE_MS);
    }, COMPLETE_DELAY);
  }, []);

  const start = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    clearTimers();
    setFade(false);
    setActive(true);
    // 下一幀才把寬度設到 85%，觸發 transition
    requestAnimationFrame(() => setWidth(85));
    safetyRef.current = setTimeout(() => complete(), SAFETY_MS);
  }, [complete]);

  // capture 階段 click 監聽：只攔截同源內部連結
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey)
        return;
      const target = e.target as HTMLElement | null;
      const link = target?.closest("a") as HTMLAnchorElement | null;
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || !href.startsWith("/")) return; // 只處理內部路徑
      if (link.target === "_blank") return;
      if (href.startsWith("#")) return; // 錨點不觸發
      const sameOrigin =
        !link.origin || link.origin === window.location.origin;
      if (!sameOrigin) return;

      const url = new URL(href, window.location.href);
      // 同一頁（路徑+query 都相同）不視為導航
      if (
        url.pathname === pathname &&
        url.search === searchParams.toString()
      )
        return;

      start();
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname, searchParams, start]);

  // pathname / search 變化 → 完成進度
  useEffect(() => {
    if (startedRef.current) complete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  if (!active) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[100] h-0.5"
      style={{
        width: `${width}%`,
        background:
          "linear-gradient(90deg, var(--color-cobalt-bright), var(--color-vital-bright))",
        opacity: fade ? 0 : 1,
        transition: fade
          ? `opacity ${FADE_MS}ms ease`
          : "width 300ms cubic-bezier(0.22,1,0.36,1)",
      }}
    />
  );
}
