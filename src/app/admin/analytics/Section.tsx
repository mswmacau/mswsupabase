"use client";

/**
 * src/app/admin/analytics/Section.tsx — 分析儀表板的區塊外殼（<768px 可折疊）
 *
 * 為什麼獨立成 client component：折疊需要 state，但整頁其餘部分（八支 RPC 的
 * 取數、圖表 SVG、明細表）都是 server component。這裡只把「外殼」變成 client，
 * 內容仍由 server 產生後以 children 傳入——client bundle 不會因此變大，
 * 資料也不會多取一次。
 *
 * 為什麼不用 <details>：<details> 收合由瀏覽器內部實作（::details-content），
 * 沒辦法用 CSS 在 ≥768px 強制展開，會變成「桌面也要點一下」——違反桌面版型不變。
 * 這裡的寫法是：手機分支吃 state、桌面分支是純靜態標題，兩者用 CSS 斷點切換，
 * 桌面完全不受 state 影響；初始 state 固定 false，SSR 與 hydration 輸出一致，
 * 不會出現 React #418（上一輪 /admin/audit-log 卡片踩過這個坑）。
 *
 * 唯讀頁面：這裡只有展開／收起，沒有任何寫入入口。
 */

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

export function Section({
  title,
  desc,
  summary,
  children,
}: {
  title: string;
  /** 區塊說明（原文不變；手機展開後才看到） */
  desc: string;
  /** 收起時露出的摘要數字（手機）；桌面不顯示 */
  summary?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <section data-analytics-section className="card-dark p-4 md:p-8">
      {/* ===== <768px：區塊名 + 摘要數字，預設收起 ===== */}
      <h3 className="text-base font-bold md:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
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
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      </h3>

      {/* ===== ≥768px：原標題（與改動前一致） ===== */}
      <h3 className="hidden text-lg font-bold md:block">{title}</h3>

      {/* 手機：收起時 hidden；桌面：永遠 block（CSS 強制展開，不吃 state） */}
      <div id={bodyId} className={open ? "block" : "hidden md:block"}>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-white/70 md:mt-1">
          {desc}
        </p>
        <div className="mt-5">{children}</div>
      </div>
    </section>
  );
}
