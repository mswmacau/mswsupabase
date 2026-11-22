"use client";

/**
 * src/components/hyrox/ChipScroller.tsx — 類別 chips 的自動捲動（P2-2）
 *
 * 【問題】390 寬度下 8 個類別 chips 一定超出畫面。用 `?d=men_double` 直接
 * 進來（例如別人貼連結），當前類別 chip 在容器右側看不見——違反方案 §1.6
 * 「第一屏可見當前類別全名」。實測容器 `scrollLeft` 停在 0，沒有任何機制
 * 把 active chip 捲進來。
 *
 * 【做法】純增強：mount 後只調整容器自己的 scrollLeft，不動整頁捲動位置。
 * 沒有 JS 時完全不受影響（chips 仍是可滑動、可點的 `<a href="?d=…">`），
 * 所以不違反「無 JS 內容可讀」的硬要求。
 *
 * 用 getBoundingClientRect 而不是 offsetLeft：offsetLeft 的參考點是最近的
 * positioned 祖先，這個容器是 static，offsetLeft 會指到更上層而算錯。
 */

import { useEffect, useRef, type ReactNode } from "react";

export function ChipScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const active = box.querySelector<HTMLElement>('[aria-current="true"]');
    if (!active) return;

    const b = box.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    // 只有真的看不到才捲，避免每次載入都移動容器造成視覺跳動
    if (a.left < b.left || a.right > b.right) {
      box.scrollLeft += a.left - b.left - 16;
    }
  }, []);

  return (
    <div
      ref={ref}
      role="group"
      aria-label="比賽類別"
      className="flex gap-2 overflow-x-auto pb-1"
    >
      {children}
    </div>
  );
}
