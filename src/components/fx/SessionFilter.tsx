"use client";

/**
 * 場次清單：按日期分組 + 手機折疊
 *
 * 站主要求（文案精簡）：
 *  - 移除「全部／本月／下月」月份篩選鈕 → 一律照日期由近到遠全部列出
 *  - 移除左側「近期場次」標題／說明／計數 → 日期分組小標就是唯一的組織方式
 *
 * 因此本元件只剩兩個職責：
 *  1. 把 items 按 sessionDate 分組，每組一個小標（例如「11/17 週二」）
 *  2. 手機（<lg）預設只顯示前 mobileVisible 場，其餘收在「顯示全部 N 場」
 *
 * 保留的既有行為：
 *  - `#session-list` id 與 `aria-controls` 仍然對應同一個容器
 *  - 超出 cap 的場次照樣 render（內容不減少），只是 <lg 用 CSS 收起來；
 *    桌面（lg 起）一律全部顯示，1440 的內容與高度不受影響
 *  - SessionCard 由 page 以已 render 好的 element 傳入，報名邏輯不變
 *
 * 分組小標用 weekdayLabelOfDate（Date.UTC 取值）而非 weekdayLabel，
 * 純日期字串不會因執行環境時區差一日，亦不會造成 hydration mismatch。
 */

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { weekdayLabelOfDate } from "@/lib/utils";

export interface SessionFilterItem {
  id: string;
  /** 'YYYY-MM-DD' */
  sessionDate: string;
  /** page 已經 render 好嘅 SessionCard element */
  card: ReactNode;
}

/** 'YYYY-MM-DD' → '11/17 週二'（日期分組小標） */
function groupLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return iso;
  const w = weekdayLabelOfDate(iso);
  return `${m[2]}/${m[3]}${w ? ` 週${w}` : ""}`;
}

interface Group {
  key: string;
  label: string;
  items: SessionFilterItem[];
  /** 該組第一場在整份清單的索引（判斷手機 cap 用） */
  start: number;
}

export function SessionFilter({
  items,
  mobileVisible,
}: {
  items: SessionFilterItem[];
  /** 手機（<lg）預設只顯示的場次數；桌面一律全部顯示。0 / 未傳 = 不折疊 */
  mobileVisible?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, SessionFilterItem[]>();
    for (const item of items) {
      const bucket = map.get(item.sessionDate);
      if (bucket) bucket.push(item);
      else map.set(item.sessionDate, [item]);
    }
    // items 已由 page 升冪排序；Map 保留插入順序，這裡再明確排序一次
    const keys = [...map.keys()].sort();
    const lengths = keys.map((key) => (map.get(key) as SessionFilterItem[]).length);
    // 每組第一場在整份清單的索引（不用可變游標，避免 render 期間的賦值）
    const starts = keys.map((_, i) =>
      lengths.slice(0, i).reduce((sum, n) => sum + n, 0)
    );
    return keys.map((key, i) => ({
      key,
      label: groupLabel(key),
      items: map.get(key) as SessionFilterItem[],
      start: starts[i],
    }));
  }, [items]);

  const cap = mobileVisible && mobileVisible > 0 ? mobileVisible : 0;
  const hiddenCount = cap > 0 ? Math.max(0, items.length - cap) : 0;

  return (
    <>
      <div id="session-list" className="space-y-10 lg:space-y-8">
        {groups.map((group) => {
          // 整組都在 cap 之後 → 手機不顯示（連小標），桌面照樣顯示
          const wholeGroupHidden = cap > 0 && !expanded && group.start >= cap;

          const heading = (
            <h3 className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
              <span className="tnum flex-none text-white/80">
                {group.label}
              </span>
              <span aria-hidden className="h-px min-w-4 flex-1 bg-white/15" />
            </h3>
          );

          const grid = (
            <div className="stagger mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item, i) =>
                cap === 0 || expanded || group.start + i < cap ? (
                  <Fragment key={item.id}>{item.card}</Fragment>
                ) : (
                  // 超出 cap 的場次照樣 render，只是 <lg 收起來
                  <div key={item.id} className="hidden lg:block">
                    {item.card}
                  </div>
                )
              )}
            </div>
          );

          return (
            <section
              key={group.key}
              data-session-group={group.key}
              className={wholeGroupHidden ? "hidden lg:block" : undefined}
            >
              {heading}
              {grid}
            </section>
          );
        })}
      </div>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="session-list"
          className="btn-base btn-ghost btn-slab mt-8 min-h-11 w-full lg:hidden"
        >
          {expanded ? "收起" : `顯示全部 ${items.length} 場`}
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
  );
}
