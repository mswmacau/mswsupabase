"use client";

/**
 * src/components/hyrox/PhotoGallery.tsx — 往期場次的相片回顧牆（client）
 *
 * 原生 <dialog> 做「點相片開大圖」：
 *   · showModal() 自帶焦點鎖與背景 inert，Esc 由 dialog 的 cancel 事件接管；
 *   · 不引入任何新依賴（lightbox 套件一律不用）；
 *   · <dialog> 自己就是全屏深色底，不需要另外寫 ::backdrop 樣式。
 *
 * 邊界：沒有相片 → 顯示「相片整理中，稍後補上」，不留空白區塊。
 * 390 寬：grid 2 欄、桌面 3 欄；單張縮圖 aspect-[4/3]，不會橫向溢出。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export interface GalleryPhoto {
  id: string;
  /** 已經轉好的公開網址（由 server 端用 publicAssetUrl 產生） */
  url: string;
  caption: string | null;
}

export function PhotoGallery({ photos }: { photos: GalleryPhoto[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = index !== null;

  // 開／關都經同一個 effect：避免 showModal/close 被呼叫兩次丟例外
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) dialog.showModal();
  }, [open]);

  // 開大圖時鎖背景滾動（原生 dialog 不負責這個）
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Esc：dialog 的 cancel 事件，同步回 state（不然 state 與畫面會不同步）
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function onCancel(event: Event) {
      event.preventDefault();
      setIndex(null);
    }
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, []);

  const step = useCallback(
    (delta: number) => {
      setIndex((current) => {
        if (current === null || photos.length === 0) return current;
        return (current + delta + photos.length) % photos.length;
      });
    },
    [photos.length]
  );

  const current = index === null ? null : photos[index] ?? null;

  if (photos.length === 0) {
    return (
      <div className="slab border border-[var(--line-fine)] bg-white/[0.03] px-4 py-10 text-center">
        <p className="text-sm font-semibold text-white/70">相片整理中，稍後補上</p>
        <p className="mt-1.5 text-xs leading-relaxed text-white/50">
          當日相片正在整理，之後會放在這一頁。可以先看下面的活動資訊。
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-3">
        {photos.map((photo, i) => (
          <li key={photo.id} className="min-w-0">
            <button
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`開啟第 ${i + 1} 張相片${photo.caption ? `：${photo.caption}` : ""}`}
              className="group block w-full overflow-hidden border border-[var(--line-fine)] bg-black/30 text-left transition hover:border-white/35"
            >
              <span className="block aspect-[4/3] w-full overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={photo.caption ?? `MSW HYROX 活動相片 ${i + 1}`}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                />
              </span>
              {photo.caption && (
                <span className="block truncate px-2.5 py-2 text-[11px] text-white/55">
                  {photo.caption}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialogRef}
        aria-label="相片大圖檢視"
        className="m-0 h-dvh max-h-none w-dvw max-w-none overflow-y-auto border-0 bg-ink p-0 text-white"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            step(-1);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            step(1);
          }
        }}
        onClick={(event) => {
          // 點深色底（不是圖片、也不是按鈕）就關閉
          if (event.target === event.currentTarget) setIndex(null);
        }}
      >
        {current && (
          <div className="flex min-h-dvh flex-col">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="stat-figure min-w-0 truncate text-xs text-white/60">
                {(index ?? 0) + 1} / {photos.length}
              </p>
              <button
                type="button"
                onClick={() => setIndex(null)}
                aria-label="關閉大圖"
                className="inline-flex min-h-11 min-w-11 items-center justify-center border border-white/25 text-white/80 transition hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>

            <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-4">
              {photos.length > 1 && (
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label="上一張"
                  className="absolute left-1 top-1/2 z-10 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center border border-white/20 bg-ink/70 text-white/80 transition hover:bg-white/10 md:left-4"
                >
                  <ChevronLeft size={22} />
                </button>
              )}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.url}
                alt={current.caption ?? "MSW HYROX 活動相片"}
                className="max-h-[72dvh] w-auto max-w-full object-contain"
              />

              {photos.length > 1 && (
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label="下一張"
                  className="absolute right-1 top-1/2 z-10 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center border border-white/20 bg-ink/70 text-white/80 transition hover:bg-white/10 md:right-4"
                >
                  <ChevronRight size={22} />
                </button>
              )}
            </div>

            {current.caption && (
              <p className="mx-auto max-w-2xl break-words px-4 pb-8 text-center text-sm leading-relaxed text-white/70">
                {current.caption}
              </p>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
