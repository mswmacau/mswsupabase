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
 * 後台選單（P1-07 A / P1-09；IA 重整第一階段 20261114）
 *
 * 兩種呈現，共用同一份 GROUPS 資料（避免兩份清單不同步）：
 *  - <768px（md 以下）：頂部 56px 列「後台 + 漢堡」＋ 全屏抽屜，選單分組。
 *    預設收起；側欄不再以 2 欄網格佔掉 424px 首屏高度。
 *  - ≥768px：垂直側欄，**同樣渲染 6 個分組標題**。
 *
 * 為什麼桌面也要分組（第一階段修的缺陷）：先前桌面只渲染 `FLAT_LINKS`
 * （把 6 組攤平），分組標題只存在於手機抽屜，於是 1440×900 的客戶看到的是
 * 「一條 20 項的長清單」，且第 20 項「設定」被外層容器的 max-height 截掉。
 * 現在兩邊共用 GROUPS，並把行高收成 34px、分組標題間距收成 6px，
 * 令 20 項在 900px 高視窗內**不需滾動**即可全部可見（行高／間距見下方常數）。
 *
 * 本階段不刪任何路由（合併頁是第二階段），只在導覽上表達主從關係：
 * 「月班表」排在「訓練場次」之前，且「訓練場次」標為「唯讀」——
 * 該頁的新增表單已移除，排課入口收斂到月班表（它是超集：按月檢視、
 * 逐場編輯、複製上月、一次發布、顏色圖例）。理由見
 * `src/app/admin/sessions/page.tsx` 檔頭。
 *
 * 【更正】先前這裡寫「該頁表單因為 upsert onConflict: "session_date"
 * 對上已移除的唯一約束而得到 Postgres 42P10」——**這個說法是錯的**，
 * `/api/admin/sessions` 早在 commit 71ead3c 就已移除 upsert。
 * 移除表單的理由是 IA 收斂，不是故障。
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
  /** 右側小字提示（例如「唯讀」）：桌面與手機抽屜都顯示，不佔額外列高 */
  hint?: string;
  /** 低頻項視覺弱化：對比降低，但仍可讀、可點、可 focus，不隱藏 */
  muted?: boolean;
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
      // 每月才看一次 → 視覺弱化（不隱藏）
      { href: "/admin/analytics", label: "數據分析", icon: BarChart3, muted: true },
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
      // 主入口是月班表（可增／改／刪＋按月發布）；訓練場次降級為唯讀查詢。
      { href: "/admin/schedule", label: "月班表", icon: CalendarRange },
      { href: "/admin/sessions", label: "訓練場次", icon: CalendarPlus, hint: "唯讀" },
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
      // 只在追查問題時看 → 視覺弱化（不隱藏）
      { href: "/admin/audit-log", label: "稽核日誌", icon: ScrollText, muted: true },
      { href: "/admin/site-settings", label: "設定", icon: Palette },
    ],
  },
];

/**
 * 桌面側欄的列高與分組標題間距（像素）。
 *
 * 這兩個數字是「20 項在 1440×900 不需滾動」的唯一來源，改動前請重算：
 *   20 × ITEM_H + (11 + 5 × GROUP_GAP) + 容器上下 padding ≤ 容器可用高度
 *   現值：20×34 + (11 + 5×19) + 16 = 804px
 *   容器 `md:max-h-[calc(100dvh-5rem)]`（900vh → 820px）→ 不觸發內部滾動；
 *   自然位置（admin/layout.tsx 的 md:pt-[5.5rem] = 88px）下「設定」bottom ≈ 892 < 900。
 */
const ITEM_H = "h-[34px]";
const GROUP_TITLE_BASE =
  "px-3 pb-0.5 text-[11px] font-bold leading-none tracking-[0.14em] text-white/45";

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
                                  : item.muted
                                    ? "text-white/55 hover:bg-white/5 hover:text-white"
                                    : "text-white/75 hover:bg-white/5 hover:text-white"
                              }`}
                            >
                              <Icon size={17} className="shrink-0" />
                              <span className="min-w-0 flex-1 truncate">
                                {item.label}
                              </span>
                              {item.hint ? (
                                <span
                                  className={`shrink-0 text-[10px] font-medium ${
                                    active ? "text-white/70" : "text-white/35"
                                  }`}
                                >
                                  {item.hint}
                                </span>
                              ) : null}
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

      {/* ===== ≥768px：垂直側欄，與手機抽屜共用同一份 GROUPS（含 6 個分組標題） ===== */}
      <nav aria-label="後台選單" className="hidden md:block">
        {GROUPS.map((group, index) => (
          <div key={group.title}>
            <p
              className={`${GROUP_TITLE_BASE} ${index === 0 ? "" : "pt-1.5"}`}
            >
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
                      aria-current={active ? "page" : undefined}
                      className={`flex ${ITEM_H} items-center gap-2.5 rounded-lg px-3 text-sm font-semibold transition ${
                        active
                          ? "bg-vital text-white"
                          : item.muted
                            ? "text-white/55 hover:bg-white/5 hover:text-white"
                            : "text-white/75 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <Icon size={16} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                      </span>
                      {item.hint ? (
                        <span
                          className={`shrink-0 text-[10px] font-medium ${
                            active ? "text-white/70" : "text-white/35"
                          }`}
                        >
                          {item.hint}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}
