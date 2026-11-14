import Link from "next/link";

/**
 * src/app/admin/_components/SectionTabNav.tsx — 後台合併頁的橫向分頁切換
 *
 * 用途（第二階段 IA 重整）：/admin/review（跑步／簽到／兌換／HYROX 付款）與
 * /admin/points（規則／補發／月度／優惠券）都需要同一套「帶數量的分頁」。
 * 集中成一支，避免兩個新頁各寫一套、一邊 44px 一邊 36px。
 *
 * 為什麼用 <nav> + aria-current 而不是 role="tablist"：
 * 分頁是**導覽**（每個 tab 會換 URL、換 server 資料），不是同一份 DOM 內的
 * 面板切換。用 tablist 必須有對應的 tabpanel 與 aria-controls，否則輔助技術
 * 會找不到面板。這裡語意上是「一組頁面連結」，Link 是正確元素。
 *
 * 390 的行為（站主鐵律：手機優先）：
 *  - 橫向可滑：外層 overflow-x-auto，不換行、不壓縮，每項 min-h-11（44px）
 *  - 每項 flex-none，否則 flex 子元素會被壓成等寬、文字擠成一團
 *  - 右側留 scroll-padding，最後一項不會貼死在邊緣
 * 1440：一行排完，靠左，間距 4px。
 */

export interface SectionTabItem {
  key: string;
  label: string;
  href: string;
  /**
   * 右側數字（待處理筆數）。
   *  - undefined：不顯示數字
   *  - null：查詢失敗 → 顯示「—」（**不顯示 0**，把失敗畫成 0 比留白更危險）
   */
  count?: number | null;
}

export function SectionTabNav({
  items,
  active,
  label,
  className = "",
}: {
  items: readonly SectionTabItem[];
  active: string;
  /** 給輔助技術的導覽名稱，例如「待審核分類」 */
  label: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={`-mx-1 overflow-x-auto px-1 pb-1 ${className}`}
    >
      <ul className="flex w-max min-w-full gap-1 rounded-xl border border-ink-line bg-ink-soft p-1">
        {items.map((item) => {
          const isActive = item.key === active;
          return (
            <li key={item.key} className="flex-none">
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-sm font-semibold transition ${
                  isActive
                    ? "bg-vital text-white"
                    : "text-white/70 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span>{item.label}</span>
                {item.count !== undefined ? (
                  <span
                    className={`tabular-nums text-xs font-bold ${
                      isActive
                        ? "text-white/80"
                        : item.count === null
                          ? "text-white/35"
                          : item.count > 0
                            ? "text-vital-bright"
                            : "text-white/40"
                    }`}
                  >
                    {item.count === null ? "—" : item.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
