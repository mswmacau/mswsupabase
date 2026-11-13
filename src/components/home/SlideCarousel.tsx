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
 *   · 左右箭頭（僅 ≥768px）、圓點指示、手機左右滑動、鍵盤 ←/→
 *   · 張數 > 6 時圓點只顯示 6 個並附「N / 16」計數，圓點列永遠單行
 *   · 有 link_url 的整張可點（next/link），沒有的不可點
 *   · slides 為空 → 整個元件回 null（不留空白區塊）
 *
 * 圖片優化：next/image + fill + object-cover（不變形）；第一張 priority、其餘預設 lazy。
 * 遠端網域已在 next.config.ts 的 remotePatterns 精確放行（只放行本專案 supabase
 * 的 /storage/v1/object/public/**），所以不要換成 <img> 以外的手寫網址。
 *
 * 手機取景（<768px）：見 slideFit() 說明，照片與標題卡要分開處理。
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
/** 圓點最多顯示幾個（超過就改用「窗口 + N / 總數」） */
const MAX_DOTS = 6;
/** 當前圓點在窗口中的位置偏移（左側留 2 個、右側留 3 個） */
const DOT_WINDOW_OFFSET = 2;

/**
 * 手機（<768px）取景方式。
 *
 * 背景：`home_slides` 沒有 fit 欄位，但目前的素材分成兩類，需要的處理相反：
 *   · real-*  實拍照片，檔案本身把照片壓在中間一條橫帶、上下補同張圖的模糊鏡像。
 *             用 object-cover 在窄視窗會把整條模糊帶都顯示出來（手機近半個畫面是糊的），
 *             所以要在手機把圖放大到只剩中間那條帶（下方 MOBILE_PHOTO_CLASS）。
 *   · slide-* 設計好的 16:9 標題卡（編號 + 中英標題），一放大就會切掉文字，
 *             所以手機改用 object-contain 完整顯示。
 *   · 其他     未來從後台上傳的新圖，沒有上述特徵 → 維持一般 object-cover。
 *
 * 這是「用檔名前綴判斷」的權宜做法，僅為現有素材而設。正解是把那 4 張照片
 * 先裁掉燒進去的模糊帶再上傳（或日後在 home_slides 加 fit 欄位），
 * 屆時這裡可以整段刪掉、回到單一 object-cover。
 */
type SlideFit = "photo" | "card" | "plain";

function slideFit(path: string): SlideFit {
  if (path.includes("/real-")) return "photo";
  if (path.includes("/slide-")) return "card";
  return "plain";
}

/**
 * 手機照片放大倍率：來源圖 1600×900，銳利帶高度約 460px（y 21%–72%），
 * 900 / 460 ≈ 1.96 剛好把上下模糊帶推出可視範圍。
 * translateY(16px) 用來把銳利帶中心（46.7%）對齊容器中心。
 */
const MOBILE_PHOTO_CLASS =
  "max-md:[transform:scale(1.96)_translateY(16px)]";

const IMAGE_CLASS: Record<SlideFit, string> = {
  photo: `object-cover ${MOBILE_PHOTO_CLASS}`,
  card: "object-cover max-md:object-contain",
  plain: "object-cover",
};

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

  // 圓點窗口：張數超過 MAX_DOTS 時只顯示當前位置附近的 6 個，
  // 起點夾在 [0, count - MAX_DOTS]，current 一定落在窗口內，且往後翻時不會來回跳。
  const dotStart =
    count > MAX_DOTS
      ? Math.min(Math.max(current - DOT_WINDOW_OFFSET, 0), count - MAX_DOTS)
      : 0;
  const dotIndexes =
    count > MAX_DOTS
      ? Array.from({ length: MAX_DOTS }, (_, k) => dotStart + k)
      : Array.from({ length: count }, (_, i) => i);

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
          className="relative h-[240px] w-full sm:h-[260px] md:h-[360px] lg:h-[360px]"
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
              const fit = slideFit(slide.path);
              const image = (
                <Image
                  src={url}
                  alt={slide.alt}
                  fill
                  sizes="(max-width: 768px) 100vw, 1200px"
                  priority={i === 0}
                  className={IMAGE_CLASS[fit]}
                />
              );

              return (
                <div
                  key={slide.id}
                  // overflow-hidden 不可省：手機把照片放大 1.96 倍後，圖片實際寬度會超出
                  // 這一格（348 → 682px），少了裁切就會溢出蓋住隔壁張、甚至壓到圓點列。
                  className="relative h-full w-full shrink-0 overflow-hidden"
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

          {/* 左右箭頭：只有一張時不顯示；手機（<768px）隱藏，避免半透明按鈕壓在人物臉上，
              手機改用滑動手勢 + 圓點 */}
          {count > 1 && (
            <>
              <button
                type="button"
                onClick={prev}
                aria-label="上一張"
                className="absolute left-2 top-1/2 hidden min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white/90 backdrop-blur transition hover:bg-black/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:left-4 md:inline-flex"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                onClick={next}
                aria-label="下一張"
                className="absolute right-2 top-1/2 hidden min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white/90 backdrop-blur transition hover:bg-black/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:right-4 md:inline-flex"
              >
                <ChevronRight size={20} />
              </button>
            </>
          )}
        </div>

        {/* 圓點指示：放在圖外，永遠單行不換行（flex-nowrap + overflow-hidden）。
            張數 > MAX_DOTS 時只顯示當前位置附近的 6 點，右側補「N / 總數」計數。 */}
        {count > 1 && (
          <div className="flex min-w-0 items-center justify-center gap-2 border-t border-white/10 px-3 py-2">
            <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
              {dotIndexes.map((i) => {
                const isActive = i === current;
                return (
                  <button
                    key={items[i].slide.id}
                    type="button"
                    onClick={() => go(i)}
                    aria-label={`第 ${i + 1} 張`}
                    aria-current={isActive ? "true" : undefined}
                    // 24×24 固定 slot：視覺是小點，但可點區域達標，且寬度固定不會讓整排左右跳動
                    className="group inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    <span
                      className={`block h-1.5 rounded-full transition-all ${
                        isActive
                          ? "w-[18px] bg-vital-bright"
                          : "w-1.5 bg-white/35 group-hover:bg-white/60"
                      }`}
                    />
                  </button>
                );
              })}
            </div>
            {count > MAX_DOTS && (
              <span
                className="shrink-0 text-xs tabular-nums text-white/60"
                aria-hidden="true"
              >
                {current + 1} / {count}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
