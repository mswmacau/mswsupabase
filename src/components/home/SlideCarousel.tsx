"use client";

/**
 * src/components/home/SlideCarousel.tsx — 首頁圖片輪播（client）
 *
 * 由 src/app/page.tsx（server component）取 getActiveSlides() 後傳入，
 * 資料來源是 public.home_slides（supabase/migration-home-slides.sql）。
 * 圖片網址一律走 publicAssetUrl()（src/lib/assets.ts:22），不自己拼 supabase 網址。
 *
 * 行為：
 *   · 自動播放 6 秒；hover / 焦點 / 觸控期間暫停
 *   · prefers-reduced-motion: reduce → 不自動播、也不做位移轉場
 *   · 左右箭頭、圓點指示、手機左右滑動、鍵盤 ←/→
 *   · 有 link_url 的整張可點（next/link），沒有的不可點
 *   · slides 為空 → 整個元件回 null（不留空白區塊）
 *
 * 圖片優化：next/image + fill + object-cover（不變形）；第一張 priority、其餘預設 lazy。
 * 遠端網域已在 next.config.ts 的 remotePatterns 精確放行（只放行本專案 supabase
 * 的 /storage/v1/object/public/**），所以不要換成 <img> 以外的手寫網址。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { publicAssetUrl } from "@/lib/assets";
import type { HomeSlide } from "@/lib/home-slides";
import { usePrefersReducedMotion } from "@/components/fx/home/usePrefersReducedMotion";

/** 自動播放間隔 */
const AUTO_MS = 6000;
/** 觸控滑動最小位移（px），太小會誤判成點擊 */
const SWIPE_MIN = 40;

export function SlideCarousel({ slides }: { slides: HomeSlide[] }) {
  // 先把「組不出公開網址」的列濾掉（例如 env 未設定），避免渲染空圖
  const items = useMemo(
    () =>
      slides
        .map((slide) => ({ slide, url: publicAssetUrl(slide.path) }))
        .filter((x): x is { slide: HomeSlide; url: string } => Boolean(x.url)),
    [slides]
  );

  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const reduced = usePrefersReducedMotion();

  const count = items.length;

  useEffect(() => {
    // paused（hover／焦點／觸控）、reduced-motion、只有一張 → 都不起 timer
    if (paused || reduced || count <= 1) return;
    const id = window.setInterval(() => {
      setActive((prev) => (prev + 1) % count);
    }, AUTO_MS);
    // cleanup 一定會清掉，元件卸載後不會有殘留 timer
    return () => window.clearInterval(id);
  }, [paused, reduced, count]);

  // 空資料：整個元件不渲染（所有 hook 已呼叫完，順序穩定）
  if (count === 0) return null;

  // 資料變動後舊的 active 可能超界，取餘數就地收斂
  const current = active % count;

  const go = (next: number) => setActive(((next % count) + count) % count);
  const prev = () => go(current - 1);
  const next = () => go(current + 1);

  const transitionClass = reduced
    ? ""
    : "transition-transform duration-500 ease-out";

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      prev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
    }
  }

  function onTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    const startX = touchStartX.current;
    touchStartX.current = null;
    setPaused(false);
    if (startX === null) return;
    const endX = e.changedTouches[0]?.clientX ?? startX;
    const delta = endX - startX;
    if (Math.abs(delta) < SWIPE_MIN) return;
    if (delta > 0) prev();
    else next();
  }

  return (
    <section
      className="container-msw min-w-0 pt-8 md:pt-12"
      role="region"
      aria-roledescription="carousel"
      aria-label="首頁形象輪播"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="relative min-w-0 overflow-hidden rounded-2xl border border-ink-line bg-ink-soft">
        <div
          className="relative h-[240px] w-full sm:h-[260px] md:h-[400px] lg:h-[460px]"
          onTouchStart={(e) => {
            setPaused(true);
            touchStartX.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={onTouchEnd}
        >
          {/* aria-live 只在容器宣告一次，切換時讀屏會唸出當前張的說明 */}
          <div
            className={`flex h-full ${transitionClass}`}
            style={{ transform: `translateX(-${current * 100}%)` }}
            aria-live="polite"
            aria-atomic="true"
          >
            {items.map(({ slide, url }, i) => {
              const isActive = i === current;
              const image = (
                <Image
                  src={url}
                  alt={slide.alt}
                  fill
                  sizes="(max-width: 768px) 100vw, 1200px"
                  priority={i === 0}
                  className="object-cover"
                />
              );

              return (
                <div
                  key={slide.id}
                  className="relative h-full w-full shrink-0"
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`第 ${i + 1} 張，共 ${count} 張`}
                  aria-hidden={!isActive}
                >
                  {slide.link_url ? (
                    // 非當前張不可 Tab 到（避免鍵盤使用者掉進看不到的內容）
                    <Link
                      href={slide.link_url}
                      aria-label={slide.alt}
                      tabIndex={isActive ? 0 : -1}
                      className="relative block h-full w-full"
                    >
                      {image}
                    </Link>
                  ) : (
                    // 沒有連結就是一張純圖，不掛任何 click 行為
                    <div className="relative h-full w-full">{image}</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 左右箭頭：只有一張時不顯示 */}
          {count > 1 && (
            <>
              <button
                type="button"
                onClick={prev}
                aria-label="上一張"
                className="absolute left-2 top-1/2 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white/90 backdrop-blur transition hover:bg-black/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:left-4"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                onClick={next}
                aria-label="下一張"
                className="absolute right-2 top-1/2 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white/90 backdrop-blur transition hover:bg-black/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:right-4"
              >
                <ChevronRight size={20} />
              </button>
            </>
          )}
        </div>

        {/* 圓點指示：放在圖外，張數多時可換行，不會蓋住圖片也不會橫向溢出 */}
        {count > 1 && (
          <div className="flex min-w-0 flex-wrap items-center justify-center gap-1 border-t border-white/10 px-2 py-1">
            {items.map(({ slide }, i) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => go(i)}
                aria-label={`第 ${i + 1} 張`}
                aria-current={i === current ? "true" : undefined}
                className="inline-flex min-h-11 min-w-8 items-center justify-center rounded-md"
              >
                <span
                  className={`block h-1.5 rounded-full transition-all ${
                    i === current
                      ? "w-6 bg-vital-bright"
                      : "w-1.5 bg-white/35 hover:bg-white/60"
                  }`}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
