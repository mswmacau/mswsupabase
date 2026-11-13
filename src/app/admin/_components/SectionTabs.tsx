import Link from "next/link";
import { CalendarDays, Trophy } from "lucide-react";

/**
 * 活動管理的兩視角切換（P1-09）
 *
 * /admin/events（一般活動）與 /admin/hyrox（HYROX 場次）原本是兩套並行的
 * 活動管理面，且後者沒有側欄入口。這裡在上方加分段切換把兩頁互連，
 * 讓使用者知道是同一件事的兩個視角；/admin/hyrox 路由保留（可能已有書籤）。
 *
 * 語意：這是「導覽」不是 tab —— 兩頁各自是完整頁面，所以用 nav + aria-current，
 * 不用 role="tablist"（那需要對應的 tabpanel，會誤導輔助技術）。
 */

const TABS = [
  { key: "events", href: "/admin/events", label: "一般活動", icon: CalendarDays },
  { key: "hyrox", href: "/admin/hyrox", label: "HYROX 場次", icon: Trophy },
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
