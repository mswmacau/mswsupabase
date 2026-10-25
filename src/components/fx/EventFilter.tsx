"use client";

/**
 * F-E2 活動分類篩選 — 階段一（Brief §2.5）
 *
 * 讀 `event.category`（types.ts 已加為 optional）。今期 DB 仲未有呢個欄位，
 * 所以：冇任何活動帶分類時，chips 完全唔 render，只出全部活動嘅網格——
 * 版面同而家一模一樣，絕對唔會穿崩。
 * 將來 `events.category` 一加、後台一填，chips 就會自動出現，前端唔使再改。
 *
 * ── 階段二動效（T-5 E11 / T-6 E12，方砚）────────────────────────────
 * E11：分類 chips 高亮底塊改用 `layoutId` 滑動（原本係純 class 硬切）。
 * E12：活動卡網格改用 `AnimatePresence mode="popLayout"`。
 *
 * ⚠️ T-6 衝突拆除（R2 / 紅線 8）：原本第 72 行嘅網格容器帶 `stagger` class，
 *    而 `globals.css` 729–746 行 `.stagger > *` 會對**直接子元素**套
 *    scroll-driven `animation`（動 transform）。CSS animation 嘅層級高於
 *    inline style，會直接蓋掉 motion 寫入嘅 transform，令 popLayout 失效
 *    並出現詭異抖動。所以：
 *      · `stagger` → `reveal-soft`（容器級進場，見下）
 *      · 容器加 `relative`：motion 嘅 popLayout 用 `offsetTop / offsetLeft`
 *        定位退場中嘅卡片（framer-motion PopChild.mjs 28–29 行），
 *        必須由網格容器本身做 offsetParent，否則會飄去版面外。
 *    改用 `reveal-soft` 而唔係淨删：任析 T-6 驗收要求「events 頁嘅進場效果
 *    仍然正常（不得消失）」。`reveal-soft` 係 globals.css 既有嘅滾動進場
 *    （keyframes msw-reveal-soft：from 同 to 嘅 opacity 都係 1，永遠唔會
 *    隱藏內容，符合「無 JS 時 100% 可見」鐵則），而且只 transform
 *    **容器**，motion 只寫 **子元素** 嘅 transform —— 兩者唔喺同一個節點，
 *    唔會再打架。
 */

import { useMemo, useState } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  type MotionProps,
} from "motion/react";
import { Search } from "lucide-react";
import { EventCard } from "@/components/EventCard";
import { useMotionReady } from "@/components/motion/MotionRoot";
import {
  CARD_SHIFT,
  MOTION_ENABLED,
  T_CARD_IN,
  T_CARD_OUT,
  T_CHIP,
} from "@/components/motion/motionConfig";
import type { Event } from "@/lib/types";
import { DEFAULT_PAGES, type SitePageEvents } from "@/lib/content";

/** 「全部」係固定顯示狀態（= 不過濾），唔係資料入面嘅分類值 */
const ALL = "全部";

/** 高亮底塊：原本 active chip 身上嘅 `bg-vital`，抽成一塊可滑動嘅底 */
const HIGHLIGHT_CLASS = "slab absolute inset-0 -z-10 bg-vital";

export function EventFilter({
  events,
  labels = DEFAULT_PAGES.events,
  isLoggedIn = false,
  registeredEventIds = [],
}: {
  events: Event[];
  labels?: SitePageEvents;
  /** T-26：會員登入狀態與已報名活動 id（傳落 EventCard 的站內報名按鈕） */
  isLoggedIn?: boolean;
  registeredEventIds?: string[];
}) {
  /** 由實際資料抽出有值嘅分類，順序照資料出現次序 */
  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const e of events) {
      const c = e.category?.trim();
      if (c) seen.add(c);
    }
    return Array.from(seen);
  }, [events]);

  const [active, setActive] = useState<string>(ALL);

  const filtered = useMemo(
    () =>
      active === ALL
        ? events
        : events.filter((e) => (e.category?.trim() ?? "") === active),
    [events, active]
  );

  /**
   * R1 / 紅線 10：SSR 同首次 hydration 一律 `initial={false}`
   * （＝直接 render `animate` 嘅可見態，SSR HTML 唔會出現 opacity:0）。
   * 只有 mount 成功之後**新掛載**嘅卡片先播進場。
   * `AnimatePresence initial={false}` 亦只對第一次 render 生效，兩層一致。
   */
  const ready = useMotionReady();

  const cardMotion: MotionProps = MOTION_ENABLED
    ? {
        initial: ready ? { opacity: 0, y: CARD_SHIFT } : false,
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -6, transition: T_CARD_OUT },
        transition: T_CARD_IN,
      }
    : {};

  return (
    <>
      {/* 無分類資料時成條 chips 列自動隱藏 */}
      {categories.length > 0 && (
        <div
          role="group"
          aria-label="活動分類"
          className="flex flex-wrap gap-2 border-b border-white/10 pb-6"
        >
          {/* E11：LayoutGroup 隔開呢一組 layoutId，唔會同其他頁嘅 chips 互相影響 */}
          <LayoutGroup id="event-category">
            {[ALL, ...categories].map((c) => {
              const activeChip = c === active;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={activeChip}
                  onClick={() => setActive(c)}
                  className={`stat-figure relative isolate inline-flex min-h-11 items-center px-4 text-sm transition ${
                    activeChip
                      ? "slab text-white"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  {activeChip ? (
                    MOTION_ENABLED ? (
                      <motion.span
                        layoutId="event-chip-active"
                        className={HIGHLIGHT_CLASS}
                        transition={T_CHIP}
                        aria-hidden
                      />
                    ) : (
                      <span className={HIGHLIGHT_CLASS} aria-hidden />
                    )
                  ) : null}
                  <span className="relative">{c}</span>
                </button>
              );
            })}
          </LayoutGroup>
        </div>
      )}

      {filtered.length ? (
        // T-6：`stagger` → `reveal-soft`（詳見檔案頂部註解）；`relative` 供 popLayout 定位
        <div className="reveal-soft relative mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* E12：popLayout — 退場卡片即時脫離排版流，後面卡片馬上補位，自己播完退場 */}
          <AnimatePresence mode="popLayout" initial={false}>
            {filtered.map((e) => (
              <motion.div key={e.id} layout {...cardMotion}>
                <EventCard
                  event={e}
                  labels={labels}
                  isLoggedIn={isLoggedIn}
                  registered={registeredEventIds.includes(e.id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="mt-10 border-y border-white/10 px-6 py-14 text-center">
          <Search size={26} className="mx-auto text-white/40" />
          <p className="mt-4 text-sm text-white/70">暫無活動</p>
        </div>
      )}
    </>
  );
}
