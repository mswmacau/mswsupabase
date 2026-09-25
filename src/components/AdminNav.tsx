"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  CalendarPlus,
  ClipboardCheck,
  Gift,
  LayoutDashboard,
  Palette,
  TicketCheck,
  Users,
} from "lucide-react";

const LINKS = [
  { href: "/admin", label: "總覽", icon: LayoutDashboard, exact: true },
  { href: "/admin/runs", label: "跑步審核", icon: ClipboardCheck },
  { href: "/admin/checkins", label: "簽到確認", icon: Users },
  { href: "/admin/monthly", label: "月度名單 / 發券", icon: Gift },
  { href: "/admin/coupons", label: "優惠券", icon: TicketCheck },
  { href: "/admin/sessions", label: "訓練場次", icon: CalendarPlus },
  { href: "/admin/events", label: "活動管理", icon: CalendarDays },
  { href: "/admin/site-settings", label: "網站設定", icon: Palette },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
      {LINKS.map((l) => {
        const active = l.exact
          ? pathname === l.href
          : pathname === l.href || pathname.startsWith(l.href + "/");
        const Icon = l.icon;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`flex shrink-0 items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              active
                ? "bg-vital text-white"
                : "text-white/60 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon size={17} />
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
