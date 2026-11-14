"use client";

/**
 * F-T3 場次月份篩選（Brief §2.2）
 *
 * page 原有嘅 `upcoming.map(<SessionCard/>)` 搬到呢度統一 render，
 * SessionCard 本身完全冇改（由 page 以已 render 嘅 element 傳入），
 * 報名邏輯（SessionAction）亦冇郁。
 *
 * 初始 state 一定係「全部」：server 同 client 第一次 render 輸出完全一致，
 * 唔會 hydration mismatch；月份判斷只會喺使用者撳 chips（client、已 hydrate）之後發生。
 *
 * ── 階段二動效（T-7 E11 第二處，方砚）────────────────────────────────
 * 月份 chips（全部／本月／下月）高亮底塊改用 `layoutId` 滑動。
 *
 * ⚠️ 只做 chips：第 78 行附近嘅卡片網格 `<div className="stagger grid ...">`
 *    **原封不動**（`stagger` 保留）。chips 同網格唔喺同一個容器，
 *    所以 `.stagger > *` 嘅 CSS animation 唔會同 motion 打架（R2）。
 * ⚠️ `card` 係 page 已經 render 好嘅 ReactNode，包 motion 後內容同報名邏輯
 *    完全唔會變 —— 本任務只喺 chips 上面加一塊可滑動嘅底。
 */

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import { MotionRoot } from "@/components/motion/MotionRoot";
import { MOTION_ENABLED, T_CHIP } from "@/components/motion/motionConfig";

export interface SessionFilterItem {
  id: string;
  /** 'YYYY-MM-DD'（只取前 7 碼做月份判斷） */
  sessionDate: string;
  /** page 已經 render 好嘅 SessionCard element */
  card: ReactNode;
}

type FilterKey = "all" | "thisMonth" | "nextMonth";

const OPTIONS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "thisMonth", label: "本月" },
  { key: "nextMonth", label: "下月" },
];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 本月 / 下月嘅 'YYYY-MM' key（以本地時間計，避免 UTC parse 差一日） */
function monthKey(offset: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** 高亮底塊：原本 active chip 身上嘅 `bg-vital`，抽成一塊可滑動嘅底 */
const HIGHLIGHT_CLASS = "slab absolute inset-0 -z-10 bg-vital";

export function SessionFilter({
  items,
  mobileVisible,
}: {
  items: SessionFilterItem[];
  /** 手機（<lg）預設只顯示的場次數；桌面一律全部顯示。0 / 未傳 = 不折疊 */
  mobileVisible?: number;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expanded, setExpanded] = useState(false);

  const visible = useMemo(() => {
    if (filter === "all") return items;
    const target = monthKey(filter === "nextMonth" ? 1 : 0);
    return items.filter((item) => item.sessionDate.slice(0, 7) === target);
  }, [items, filter]);

  const cap = mobileVisible && mobileVisible > 0 ? mobileVisible : 0;
  const hiddenCount = cap > 0 ? Math.max(0, visible.length - cap) : 0;

  return (
    <MotionRoot>
      <div
        role="group"
        aria-label="場次月份"
        className="mb-8 flex flex-wrap gap-2 border-b border-white/10 pb-6"
      >
        {/* E11：LayoutGroup 隔開呢一組 layoutId */}
        <LayoutGroup id="session-month">
          {OPTIONS.map((opt) => {
            const active = opt.key === filter;
            return (
              <button
                key={opt.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(opt.key)}
                className={`stat-figure relative isolate inline-flex min-h-11 items-center px-4 text-sm transition ${
                  active ? "slab text-white" : "text-white/60 hover:text-white"
                }`}
              >
                {active ? (
                  MOTION_ENABLED ? (
                    <motion.span
                      layoutId="session-month-active"
                      className={HIGHLIGHT_CLASS}
                      transition={T_CHIP}
                      aria-hidden
                    />
                  ) : (
                    <span className={HIGHLIGHT_CLASS} aria-hidden />
                  )
                ) : null}
                <span className="relative">{opt.label}</span>
              </button>
            );
          })}
        </LayoutGroup>
      </div>

      {/* ⚠️ 呢個網格維持原狀：`stagger` class 保留、唔加任何 motion（T-7 範圍只係 chips） */}
      {visible.length ? (
        <>
          <div id="session-list" className="stagger grid gap-5 sm:grid-cols-2">
            {visible.map((item, i) =>
              cap === 0 || i < cap ? (
                <Fragment key={item.id}>{item.card}</Fragment>
              ) : (
                // P2-1：超出 cap 的場次照樣 render（內容不減少），只是 <lg 收起來。
                // 桌面 lg 起一律顯示，1440 的內容與高度完全不變。
                <div
                  key={item.id}
                  className={expanded ? "" : "hidden lg:block"}
                >
                  {item.card}
                </div>
              )
            )}
          </div>

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-controls="session-list"
              className="btn-base btn-ghost btn-slab mt-6 min-h-11 w-full lg:hidden"
            >
              {expanded ? "收起" : `顯示全部 ${visible.length} 場`}
              <ChevronDown
                size={16}
                aria-hidden
                className={`transition-transform duration-200 ${
                  expanded ? "rotate-180" : ""
                }`}
              />
            </button>
          )}
        </>
      ) : (
        <p className="border-y border-white/10 px-6 py-14 text-center text-sm text-white/70">
          目前沒有已排定的場次。
        </p>
      )}
    </MotionRoot>
  );
}
