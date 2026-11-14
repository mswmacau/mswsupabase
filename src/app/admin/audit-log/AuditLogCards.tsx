"use client";

/**
 * src/app/admin/audit-log/AuditLogCards.tsx — 操作紀錄的 <768px 卡片版型
 *
 * 為什麼是 client component：手機卡片要「摘要截斷 + 可展開」，但摘要甚麼時候
 * 真的被截斷（超過兩行）只有排版後才知道。這裡用 useLayoutEffect 量
 * scrollHeight / clientHeight：
 *   · 沒截斷 → 卡片就是靜態文字，不長出任何假的可點區
 *   · 被截斷 → 才變成可展開，箭頭也會轉向
 * 量測前先當成「會被截斷」（clamp 一律套著），SSR 與 hydration 的輸出因此一致，
 * 不會有 React #418；量完再把不需要的展開入口收掉。
 *
 * 稽核日誌是唯讀的：這裡只有展開／收起，沒有任何寫入入口。
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

/** 由 server component 算好的人話字串（label 對照表留在 server，不進 client bundle） */
export interface AuditCardRow {
  id: string;
  time: string;
  actor: string;
  module: string;
  action: string;
  summary: string;
}

/** SSR 期間沒有 layout 可量：server 端退回 useEffect（不會警告），瀏覽器端用 useLayoutEffect（首帧前量好） */
const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function AuditCard({ row }: { row: AuditCardRow }) {
  const [open, setOpen] = useState(false);
  /** 先假設會被截斷：clamp 一律套著，量到沒溢出再把展開入口收掉 */
  const [clamped, setClamped] = useState(true);
  const textRef = useRef<HTMLSpanElement>(null);

  useIsoLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;

    const measure = () => {
      // 展開時高度已經變了，不要在這裡覆寫（否則箭頭會在展開瞬間消失）
      if (open) return;
      setClamped(el.scrollHeight > el.clientHeight + 1);
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, row.summary]);

  const content = (
    <>
      <span className="flex min-h-11 items-center gap-3">
        <span className="shrink-0 font-mono text-xs tabular-nums text-white/75">
          {row.time}
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-white/75">
          {row.actor}
        </span>
        {clamped && (
          <ChevronDown
            size={16}
            aria-hidden
            className={`shrink-0 text-white/45 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        )}
      </span>

      <span className="flex flex-wrap items-center gap-1.5">
        <span className="slab border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-white/70">
          {row.module}
        </span>
        <span className="slab border border-vital/40 bg-vital/10 px-2 py-0.5 text-[11px] font-semibold text-vital-bright">
          {row.action}
        </span>
      </span>

      {/* 注意：line-clamp-2 自帶 display:-webkit-box，不能再同時掛 block，
          否則 display 會被 block 蓋掉、截斷整個失效。 */}
      <span
        ref={textRef}
        className={`break-words text-sm leading-relaxed text-white/85 ${
          open ? "block" : "line-clamp-2"
        }`}
      >
        {row.summary}
      </span>
    </>
  );

  return (
    <li className="overflow-hidden rounded-xl border border-ink-line">
      {clamped ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full flex-col gap-2 p-3.5 text-left transition hover:bg-white/5"
        >
          {content}
        </button>
      ) : (
        <div className="flex flex-col gap-2 p-3.5">{content}</div>
      )}
    </li>
  );
}

export function AuditLogCards({ rows }: { rows: AuditCardRow[] }) {
  return (
    <ul className="space-y-2 md:hidden">
      {rows.map((row) => (
        <AuditCard key={row.id} row={row} />
      ))}
    </ul>
  );
}
