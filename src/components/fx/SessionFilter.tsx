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
 */

import { Fragment, useMemo, useState, type ReactNode } from "react";

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

export function SessionFilter({ items }: { items: SessionFilterItem[] }) {
  const [filter, setFilter] = useState<FilterKey>("all");

  const visible = useMemo(() => {
    if (filter === "all") return items;
    const target = monthKey(filter === "nextMonth" ? 1 : 0);
    return items.filter((item) => item.sessionDate.slice(0, 7) === target);
  }, [items, filter]);

  return (
    <>
      <div
        role="group"
        aria-label="場次月份"
        className="mb-8 flex flex-wrap gap-2 border-b border-white/10 pb-6"
      >
        {OPTIONS.map((opt) => {
          const active = opt.key === filter;
          return (
            <button
              key={opt.key}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(opt.key)}
              className={`stat-figure inline-flex min-h-11 items-center px-4 text-sm transition ${
                active
                  ? "slab bg-vital text-white"
                  : "text-white/60 hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {visible.length ? (
        <div className="stagger grid gap-5 sm:grid-cols-2">
          {visible.map((item) => (
            <Fragment key={item.id}>{item.card}</Fragment>
          ))}
        </div>
      ) : (
        <p className="border-y border-white/10 px-6 py-14 text-center text-sm text-white/70">
          目前沒有已排定的場次。
        </p>
      )}
    </>
  );
}
