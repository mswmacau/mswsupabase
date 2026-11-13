"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * 班表詳情面板的無障礙行為（Esc 關閉 / Tab 鎖在面板內 / 鎖背景捲動 / 還原焦點）。
 *
 * 為什麼不直接 import `src/app/admin/members/useOverlay.ts`：
 *   那是後台模組，前台頁面 import 它會把 admin 的模組圖拉進公開 bundle；
 *   而本次的檔案邊界也不允許把那段邏輯搬到 `src/lib/`。
 *   這裡只留前台真正需要的四件事，行為與後台版本一致。
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function usePanelOverlay(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void
) {
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const container = containerRef.current;
    // 觸發來源通常是日曆上的 pill：關閉後把焦點還回去，
    // 否則鍵盤使用者會掉到頁面最前面。
    const previousActive =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function focusables(): HTMLElement[] {
      if (!container) return [];
      return Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.getClientRects().length > 0);
    }

    const initial =
      container?.querySelector<HTMLElement>("[data-autofocus]") ??
      focusables()[0] ??
      container;
    initial?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !container) return;

      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (
        event.shiftKey &&
        (active === first ||
          !(active instanceof Node) ||
          !container.contains(active))
      ) {
        event.preventDefault();
        last.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActive?.focus();
    };
  }, [open, containerRef]);
}
