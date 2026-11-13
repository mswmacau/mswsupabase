"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  ClipboardCheck,
  Dumbbell,
  FileText,
  Gift,
  Images,
  LayoutDashboard,
  Menu,
  Palette,
  ScrollText,
  SlidersHorizontal,
  Store,
  TicketCheck,
  Trophy,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useOverlay } from "@/app/admin/members/useOverlay";

/**
 * 後台選單（P1-07 A / P1-09）
 *
 * 兩種呈現，共用同一份 GROUPS 資料（避免兩份清單不同步）：
 *  - <768px（md 以下）：頂部 56px 列「後台 + 漢堡」＋ 全屏抽屜，選單分組。
 *    預設收起；側欄不再以 2 欄網格佔掉 424px 首屏高度。
 *  - ≥768px：原本的垂直側欄（同樣的 active 樣式、同樣的間距），
 *    不分組標題，只是把 /admin/hyrox 補進「活動管理」後面（P1-09 孤兒頁）。
 *
 * 抽屜的三個坑（與 src/components/MobileNav.tsx 一致的做法）：
 *  1. 遮罩一定用 createPortal 掛到 <body>：祖先若有 backdrop-filter / transform
 *     會成為 position:fixed 的 containing block，留在原處會塌成 56px 高。
 *  2. 開關狀態用「開啟當下的 pathname」推導（openPath），換頁自動收起，
 *     不需要在 effect 裡 setState（會觸發 react-hooks/set-state-in-effect）。
 *  3. mounted 用 useSyncExternalStore 取得，保證 SSR / 首屏 hydration 輸出一致。
 *
 * Esc 關閉、Tab focus 循環、鎖背景滾動、焦點還原都交給 useOverlay
 * （src/app/admin/members/useOverlay.ts；該檔是後台抽屜／對話框的共用行為）。
 */

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    title: "總覽",
    items: [
      { href: "/admin", label: "總覽", icon: LayoutDashboard, exact: true },
      { href: "/admin/analytics", label: "數據分析", icon: BarChart3 },
    ],
  },
  {
    title: "內容",
    items: [
      { href: "/admin/slides", label: "首頁輪播", icon: Images },
      { href: "/admin/content", label: "頁面文案", icon: FileText },
      { href: "/admin/coaches", label: "教練", icon: Dumbbell },
    ],
  },
  {
    title: "活動",
    items: [
      { href: "/admin/events", label: "活動管理", icon: CalendarDays },
      // P1-09：HYROX 場次原本沒有入口（孤兒頁），納入導覽但不刪路由。
      { href: "/admin/hyrox", label: "HYROX 場次", icon: Trophy },
      { href: "/admin/sessions", label: "訓練場次", icon: CalendarPlus },
      { href: "/admin/schedule", label: "月班表", icon: CalendarRange },
    ],
  },
  {
    title: "會員",
    items: [
      { href: "/admin/members", label: "會員管理", icon: Users },
      { href: "/admin/checkins", label: "簽到確認", icon: ClipboardCheck },
      { href: "/admin/runs", label: "跑步紀錄", icon: ClipboardCheck },
      { href: "/admin/point-rules", label: "積分", icon: SlidersHorizontal },
      { href: "/admin/monthly", label: "月度名單 / 發券", icon: Gift },
    ],
  },
  {
    title: "商城",
    items: [
      { href: "/admin/rewards", label: "禮品管理", icon: Gift },
      { href: "/admin/redemptions", label: "兌換管理", icon: TicketCheck },
      { href: "/admin/merchants", label: "商戶管理", icon: Store },
    ],
  },
  {
    title: "系統",
    items: [
      { href: "/admin/coupons", label: "優惠券", icon: TicketCheck },
      { href: "/admin/audit-log", label: "稽核日誌", icon: ScrollText },
      { href: "/admin/site-settings", label: "設定", icon: Palette },
    ],
  },
];

/** 桌面側欄用：攤平後維持一個垂直列表（不分組標題） */
const FLAT_LINKS: NavItem[] = GROUPS.flatMap((group) => group.items);

function isActive(item: NavItem, pathname: string): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(item.href + "/");
}

const subscribeNoop = () => () => {};

export function AdminNav() {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath !== null && openPath === pathname;

  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerId = "admin-nav-drawer";

  // client mount 後才為 true：SSR 與首屏 hydration 都輸出 false，避免不一致
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );

  useOverlay(open && mounted, drawerRef, () => setOpenPath(null));

  return (
    <>
      {/* ===== 手機：56px 列（不佔首屏），點漢堡開抽屜 ===== */}
      <div className="flex h-14 items-center justify-between gap-3 px-3 md:hidden">
        <span className="min-w-0 truncate text-base font-black tracking-tight">
          後台
        </span>
        <button
          type="button"
          aria-label="開啟後台選單"
          aria-expanded={open}
          aria-controls={drawerId}
          onClick={() => setOpenPath(pathname)}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 text-sm font-semibold text-white/85 transition hover:bg-white/10"
        >
          {/* 站點導覽列上方也有一顆漢堡；這裡帶「選單」二字與它區分，避免誤點 */}
          <Menu size={20} />
          選單
        </button>
      </div>

      {/* ===== 手機抽屜：分組、44px 項目、點項目即關閉 ===== */}
      {open && mounted
        ? createPortal(
            <div
              id={drawerId}
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label="後台選單"
              tabIndex={-1}
              className="fixed inset-0 z-[70] overflow-y-auto bg-ink/95 backdrop-blur-xl md:hidden"
            >
              <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-white/10 bg-ink/95 px-3 backdrop-blur">
                <span className="min-w-0 truncate text-base font-black tracking-tight">
                  後台
                </span>
                <button
                  type="button"
                  data-autofocus
                  aria-label="關閉後台選單"
                  onClick={() => setOpenPath(null)}
                  className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white/85 transition hover:bg-white/10"
                >
                  <X size={22} />
                </button>
              </div>

              <nav aria-label="後台選單" className="px-3 pb-10">
                {GROUPS.map((group) => (
                  <div key={group.title}>
                    <p className="px-3 pt-4 pb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
                      {group.title}
                    </p>
                    <ul>
                      {group.items.map((item) => {
                        const active = isActive(item, pathname);
                        const Icon = item.icon;
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              onClick={() => setOpenPath(null)}
                              aria-current={active ? "page" : undefined}
                              className={`flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-sm font-semibold transition ${
                                active
                                  ? "bg-vital text-white"
                                  : "text-white/75 hover:bg-white/5 hover:text-white"
                              }`}
                            >
                              <Icon size={17} className="shrink-0" />
                              <span className="min-w-0 flex-1 truncate">
                                {item.label}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </nav>
            </div>,
            document.body
          )
        : null}

      {/* ===== ≥768px：原本的垂直側欄 ===== */}
      <nav className="hidden md:flex md:flex-col">
        {FLAT_LINKS.map((item) => {
          const active = isActive(item, pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                active
                  ? "bg-vital text-white"
                  : "text-white/75 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon size={17} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
