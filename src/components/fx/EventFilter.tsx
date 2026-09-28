"use client";

/**
 * F-E2 活動分類篩選 — 階段一（Brief §2.5）
 *
 * 讀 `event.category`（types.ts 已加為 optional）。今期 DB 仲未有呢個欄位，
 * 所以：冇任何活動帶分類時，chips 完全唔 render，只出全部活動嘅網格——
 * 版面同而家一模一樣，絕對唔會穿崩。
 * 將來 `events.category` 一加、後台一填，chips 就會自動出現，前端唔使再改。
 */

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { EventCard } from "@/components/EventCard";
import type { Event } from "@/lib/types";

/** 「全部」係固定顯示狀態（= 不過濾），唔係資料入面嘅分類值 */
const ALL = "全部";

export function EventFilter({ events }: { events: Event[] }) {
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

  return (
    <>
      {/* 無分類資料時成條 chips 列自動隱藏 */}
      {categories.length > 0 && (
        <div
          role="group"
          aria-label="活動分類"
          className="flex flex-wrap gap-2 border-b border-white/10 pb-6"
        >
          {[ALL, ...categories].map((c) => {
            const activeChip = c === active;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={activeChip}
                onClick={() => setActive(c)}
                className={`stat-figure inline-flex min-h-11 items-center px-4 text-sm transition ${
                  activeChip
                    ? "slab bg-vital text-white"
                    : "text-white/60 hover:text-white"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      )}

      {filtered.length ? (
        <div className="stagger mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
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
