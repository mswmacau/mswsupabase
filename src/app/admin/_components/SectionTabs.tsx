import Link from "next/link";
import { CalendarDays, Trophy } from "lucide-react";

/**
 * 活動管理的兩視角切換（P1-09；IA 第二階段 20261114 改為同頁分頁）
 *
 * 第二階段：`/admin/hyrox` 的入口在側欄下架，HYROX 場次成為
 * `/admin/events?tab=hyrox` 的第二個分頁（同一張 `events` 表，只是欄位不同）。
 * 舊路由 `/admin/hyrox` **保留**（可能有人 bookmark），仍會渲染本元件並高亮 HYROX。
 *
 * 語意：這是「導覽」不是 tab —— 每個分頁都有自己的 URL 與伺服器資料，
 * 所以用 nav + aria-current，不用 role="tablist"（那需要對應的 tabpanel，
 * 否則輔助技術會找不到面板）。
 *
 * 390：兩項各 flex-1 撐滿、min-h-11（44px），不換行。
 */

const TABS = [
  { key: "events", href: "/admin/events", label: "一般活動", icon: CalendarDays },
  { key: "hyrox", href: "/admin/events?tab=hyrox", label: "HYROX 場次", icon: Trophy },
] as const;

export function SectionTabs({ active }: { active: "events" | "hyrox" }) {
  return (
    <nav
      aria-label="活動管理切換"
      className="flex gap-1 rounded-xl border border-ink-line bg-ink-soft p-1"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition sm:flex-none ${
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
