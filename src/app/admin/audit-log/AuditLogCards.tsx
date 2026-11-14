"use client";

/**
 * src/app/admin/audit-log/AuditLogCards.tsx — 操作紀錄的 <768px 卡片版型
 *
 * 為什麼是 client component：手機卡片要「摘要截斷 + 可展開」，但摘要甚麼時候
 * 真的被截斷（超過一行）只有排版後才知道。這裡用 useLayoutEffect 量
 * scrollHeight / clientHeight：
 *   · 沒截斷 → 卡片就是靜態文字，不長出任何假的可點區
 *   · 被截斷 → 才變成可展開，箭頭也會轉向
 * 量測前先當成「會被截斷」（clamp 一律套著），SSR 與 hydration 的輸出因此一致，
 * 不會有 React #418；量完再把不需要的展開入口收掉。
 *
 * 【為什麼壓得這麼扁】
 * 改動前每張卡約 160px（標頭列 min-h-11 + badges 獨立一列 + 摘要兩行），
 * 100 張 = 17,081px。現在分頁成每頁 20 筆，但 20 × 160 仍然是 3,200px，
 * 加上頁首就超過 3,000px 的目標。所以改成緊湊三行（時間／標籤＋操作者／
 * 摘要單行），單張 74px：20 張 ≈ 1,480px。
 *
 * 高度預算（390×844 實測）：整頁 3,000px 減掉全站外殼（header 65 + footer 757
 * + section 上下留白）約 1,000px，內容區只剩約 2,000px 可用；扣掉頁首 103、
 * 分頁器 66、頁尾說明 40 與 4 個 24px 間距，卡片與間距合計必須 ≤1,700px
 * → 20 張 × 74 + 19 × 6 = 1,594px。
 *
 * 壓縮後仍不犧牲可讀性與可點性：
 *   · 整個 <li> 內的那顆 button 就是觸控目標，卡片總高 74px ≫ 44px，
 *     所以內層的標頭列不需要再撐 min-h-11（那是「獨立小按鈕」才需要的）。
 *   · 摘要被截成一行，但點一下卡片就展開全文 —— 資訊沒有少，只是預設收起。
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
      {/* 第一行：時間（mono 等寬，掃視時對得齊）＋ 展開指示 */}
      <span className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-[11px] tabular-nums leading-4 text-white/75">
          {row.time}
        </span>
        {clamped && (
          <ChevronDown
            size={14}
            aria-hidden
            className={`ml-auto shrink-0 text-white/45 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        )}
      </span>

      {/* 第二行：模組／動作標籤 ＋ 操作者（靠右截斷）
          容器上的 min-w-0 是 truncate 生效的前提，少了它 flex 子元素不會縮。 */}
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="slab shrink-0 border border-white/15 bg-white/5 px-1.5 text-[10px] font-semibold leading-4 text-white/70">
          {row.module}
        </span>
        <span className="slab shrink-0 border border-vital/40 bg-vital/10 px-1.5 text-[10px] font-semibold leading-4 text-vital-bright">
          {row.action}
        </span>
        <span className="ml-auto min-w-0 truncate text-[11px] leading-4 text-white/60">
          {row.actor}
        </span>
      </span>

      {/* 第三行：摘要（預設單行，點卡片展開全文）
          leading-tight 而非 leading-snug：這一行直接決定卡片高度，
          20 張 × 省下的 2px 就是 40px（見檔頭的高度預算）。
          注意：line-clamp-1 自帶 display:-webkit-box，不能再同時掛 block，
          否則 display 會被 block 蓋掉、截斷整個失效。 */}
      <span
        ref={textRef}
        className={`break-words text-[13px] leading-tight text-white/85 ${
          open ? "block" : "line-clamp-1"
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
          className="flex w-full flex-col gap-1 px-3 py-2 text-left transition hover:bg-white/5"
        >
          {content}
        </button>
      ) : (
        <div className="flex flex-col gap-1 px-3 py-2">{content}</div>
      )}
    </li>
  );
}

export function AuditLogCards({ rows }: { rows: AuditCardRow[] }) {
  return (
    <ul className="space-y-1.5 md:hidden">
      {rows.map((row) => (
        <AuditCard key={row.id} row={row} />
      ))}
    </ul>
  );
}
