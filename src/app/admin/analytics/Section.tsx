"use client";

/**
 * src/app/admin/analytics/Section.tsx — 分析儀表板的區塊外殼（兩個寬度都可折疊）
 *
 * 為什麼獨立成 client component：折疊需要 state，但整頁其餘部分（八支 RPC 的
 * 取數、圖表 SVG、明細表）都是 server component。這裡只把「外殼」變成 client，
 * 內容仍由 server 產生後以 children 傳入——client bundle 不會因此變大，
 * 資料也不會多取一次。
 *
 * 為什麼不用 <details>：<details> 收合由瀏覽器內部實作（::details-content），
 * 沒辦法指定「桌面預設展開某幾組、其餘收起」。
 *
 * 同一份 DOM 兼顧兩個寬度（站主鐵律：電腦與手機行為一致）：
 *   · 一個 body（id 只有一個，不會重複），收起＝hidden、展開＝block。
 *   · 兩顆折疊鈕（手機版 / 桌面版）各自 display 互斥，aria-controls 都指向同一個 body。
 *   · 狀態只有一份：open === null 代表「使用者還沒動過」，此時跟預設值走
 *     （桌面：只有 defaultOpenDesktop 為 true 的區塊展開；手機：全部收起）。
 *     使用者點過之後就完全依他的選擇，寬度切換也不會被預設值蓋回去。
 *
 * defaultOpenDesktop 目前只有「會員增長」一組傳 true。實測（1440 寬）：
 * 全收起約 1,3xx px，加會員增長 +388px；而「訓練場次出席」單組內容 ~2,100px，
 * 讓它預設展開會到 3,906px，超過「桌面初始 ≤3,500」的目標。
 *
 * 唯讀頁面：這裡只有展開／收起，沒有任何寫入入口。
 */

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useIsDesktop } from "../_components/useIsDesktop";

export function Section({
  title,
  desc,
  summary,
  defaultOpenDesktop = false,
  children,
}: {
  title: string;
  /** 區塊說明（原文不變；展開後才看到） */
  desc: string;
  /** 收起時露出的摘要數字（只給手機用，桌面維持原標題） */
  summary?: string;
  /** 桌面（≥768px）預設是否展開；手機一律預設收起（不動手機首屏高度） */
  defaultOpenDesktop?: boolean;
  children: React.ReactNode;
}) {
  /** null＝使用者尚未操作，跟預設值；true/false＝使用者明確選擇 */
  const [open, setOpen] = useState<boolean | null>(null);
  const isDesktop = useIsDesktop();
  const isOpen = open ?? (isDesktop && defaultOpenDesktop);
  const bodyId = useId();

  const toggle = () => setOpen(!isOpen);

  return (
    <section data-analytics-section className="card-dark p-4 md:p-8">
      {/* ===== <768px：區塊名 + 摘要數字 ===== */}
      <h3 className="text-base font-bold md:hidden">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={toggle}
          className="flex min-h-11 w-full items-center gap-3 text-left"
        >
          <span className="min-w-0 flex-1">{title}</span>
          {summary && (
            <span className="shrink-0 text-xs font-bold tabular-nums text-white/65">
              {summary}
            </span>
          )}
          <ChevronDown
            size={16}
            aria-hidden
            className={`shrink-0 text-white/45 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>
      </h3>

      {/* ===== ≥768px：標題本身也是折疊鈕（箭頭跟在標題後，兩頁一致） ===== */}
      <h3 className="hidden text-lg font-bold md:block">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={bodyId}
          onClick={toggle}
          className="flex min-h-11 items-center gap-2 text-left"
        >
          <span>{title}</span>
          <ChevronDown
            size={18}
            aria-hidden
            className={`shrink-0 text-white/45 transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>
      </h3>

      {/* 收起＝hidden（兩個寬度都一樣）；展開＝block */}
      <div id={bodyId} className={isOpen ? "block" : "hidden"}>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-white/70 md:mt-1">
          {desc}
        </p>
        <div className="mt-5">{children}</div>
      </div>
    </section>
  );
}
