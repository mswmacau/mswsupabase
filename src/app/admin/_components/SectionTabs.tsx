import Link from "next/link";
import { CalendarDays, Flag, Trophy } from "lucide-react";

/**
 * 活動管理的三視角切換（P1-09；IA 第二階段 20261114 改為同頁分頁；
 * 第三階段 20261120 加入「賽事」）
 *
 * 第二階段：`/admin/hyrox` 的入口在側欄下架，HYROX 場次成為
 * `/admin/events?tab=hyrox` 的第二個分頁（同一張 `events` 表，只是欄位不同）。
 * 舊路由 `/admin/hyrox` **保留**（可能有人 bookmark），仍會渲染本元件並高亮 HYROX。
 *
 * 第三階段：賽事（series='race'）成為第三個分頁 `/admin/events?tab=races`。
 * **側欄不新增項目**——後台已經太多項，賽事管理就住在「活動」裡面。
 *
 * 語意：這是「導覽」不是 tab —— 每個分頁都有自己的 URL 與伺服器資料，
 * 所以用 nav + aria-current，不用 role="tablist"（那需要對應的 tabpanel，
 * 否則輔助技術會找不到面板）。
 *
 * 390：三項都不能擠成一團，也不能撐破版面。做法是每個分頁
 * `shrink-0`（保持文字完整）+ nav `overflow-x-auto`（真放不下時可橫向滑），
 * 實測 390 三項約 313px < 可用寬度，正常情況一行放得下、不會出現滾動條。
 */

const TABS = [
  { key: "events", href: "/admin/events", label: "一般活動", icon: CalendarDays },
  { key: "hyrox", href: "/admin/events?tab=hyrox", label: "HYROX 場次", icon: Trophy },
  { key: "races", href: "/admin/events?tab=races", label: "賽事", icon: Flag },
] as const;

export function SectionTabs({
  active,
}: {
  active: "events" | "hyrox" | "races";
}) {
  return (
    <nav
      aria-label="活動管理切換"
      className="flex min-w-0 gap-1 overflow-x-auto rounded-xl border border-ink-line bg-ink-soft p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            data-tab={tab.key}
            aria-current={isActive ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition ${
              isActive
                ? "bg-vital text-white"
                : "text-white/70 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon size={15} className="shrink-0" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
