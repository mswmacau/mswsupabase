"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  Dumbbell,
  FileText,
  Gift,
  Images,
  LayoutDashboard,
  Menu,
  Package,
  Palette,
  ScrollText,
  TicketCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useOverlay } from "@/app/admin/members/useOverlay";

/**
 * 後台選單（P1-07 A / P1-09；IA 重整 第一階段 20261114、**第二階段 20261114**）
 *
 * 兩種呈現，共用同一份 GROUPS 資料（避免兩份清單不同步）：
 *  - <768px：頂部 56px 列「後台 + 選單」＋ 全屏抽屜（分組、每項 44px）。
 *  - ≥768px：垂直側欄，同樣渲染 6 個分組標題。
 *
 * ── 第二階段：20 項 → 14 項（6 組），合併 6 個入口 ──────────────────────
 * 合併的是「入口」，不是功能；被合併的路由**全部保留**（可能有人 bookmark），
 * 舊頁頂部改放 `MovedNotice` 導引橫幅到新位置：
 *   1. 訓練場次 /admin/sessions   → 班表 /admin/schedule（該頁第一階段已改唯讀）
 *   2. HYROX 場次 /admin/hyrox    → 活動 /admin/events?tab=hyrox
 *   3. 簽到確認 /admin/checkins   ┐
 *   4. 跑步紀錄 /admin/runs       ┴→ 待審核 /admin/review（4 個分頁）
 *      ＋兌換待審批、HYROX 付款待確認也收進同一頁的另外兩個分頁
 *   5. 積分 /admin/point-rules    ┐
 *   6. 月度名單 /admin/monthly    ├→ 積分與發券 /admin/points（3–4 個分頁）
 *   7. 優惠券 /admin/coupons      ┘
 *   8. 商戶管理 /admin/merchants  → 兌換與商戶 /admin/redemptions?tab=merchants
 * （淨減 6 項 = 20 − 14：sessions、hyrox、runs+checkins 兩項併一項、
 *   point-rules／monthly／coupons 三項併一項、merchants。）
 *
 * ── 為什麼桌面前一版會「看不到最後一項」──────────────────────────────
 * 舊版桌面把分組攤平成 FLAT_LINKS，分組標題只存在於手機抽屜，於是 1440×900
 * 看到的是一條 20 項長清單。第一階段已改為桌面也渲染 GROUPS（34px 列高）。
 * 現在 14 項：14×34 + 6×~19 + padding ≈ 606px，容器可用高度 820px，
 * **不需要內部滾動**（驗算見下方常數註解）。
 *
 * ── 待辦數字（第二階段 C）──────────────────────────────────────────
 * `pendingTotal` 由 `src/app/admin/layout.tsx`（Server）用 `getAdminTodoCounts()`
 * 算好傳入（4 支 head:true count 查詢）。顯示紀律：
 *   null（查詢失敗／未連接 DB）→ 顯示「—」，**不顯示 0**。
 *   把失敗畫成 0，等於告訴管理員「今天沒事」，比留白更危險。
 *
 * 抽屜的三個坑（與 src/components/MobileNav.tsx 一致的做法）：
 *  1. 遮罩用 createPortal 掛到 <body>：祖先若有 backdrop-filter / transform
 *     會成為 position:fixed 的 containing block，留在原處會塌成 56px 高。
 *  2. 開關狀態用「開啟當下的 pathname」推導（openPath），換頁自動收起，
 *     不需要在 effect 裡 setState（會觸發 react-hooks/set-state-in-effect）。
 *  3. mounted 用 useSyncExternalStore 取得，保證 SSR / 首屏 hydration 輸出一致。
 *
 * Esc 關閉、Tab focus 循環、鎖背景滾動、焦點還原都交給 useOverlay
 * （src/app/admin/members/useOverlay.ts）。
 */

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** 低頻項視覺弱化：對比降低，但仍可讀、可點、可 focus，不隱藏 */
  muted?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * 14 項 / 6 組。圖示 14 個互不重複（S3-1：先前 ClipboardCheck 同時用在
 * 簽到與跑步、Gift 同時用在發券與禮品、TicketCheck 同時用在兌換與優惠券）。
 */
const GROUPS: NavGroup[] = [
  {
    title: "今日",
    items: [
      { href: "/admin", label: "今日工作台", icon: LayoutDashboard, exact: true },
      // 每月才看一次 → 視覺弱化（不隱藏）
      { href: "/admin/analytics", label: "數據分析", icon: BarChart3, muted: true },
    ],
  },
  {
    title: "開課",
    items: [
      // 班表是排課唯一入口（吸收訓練場次：按月檢視、逐場編輯、複製上月、一次發布）
      { href: "/admin/schedule", label: "班表", icon: CalendarRange },
      // 活動分兩個分頁（一般活動 / HYROX），吸收 HYROX 場次
      { href: "/admin/events", label: "活動", icon: CalendarDays },
    ],
  },
  {
    title: "會員",
    items: [
      { href: "/admin/members", label: "會員", icon: Users },
      // 此項右側顯示總待處理數（見 pendingTotal）
      { href: "/admin/review", label: "待審核", icon: ClipboardCheck },
      // 規則／補發獎勵／月度達標／優惠券 四個分頁
      { href: "/admin/points", label: "積分與發券", icon: Gift },
    ],
  },
  {
    title: "兌換",
    items: [
      { href: "/admin/rewards", label: "禮品", icon: Package },
      // 兌換紀錄／商戶 PIN 兩個分頁
      { href: "/admin/redemptions", label: "兌換與商戶", icon: TicketCheck },
    ],
  },
  {
    title: "網站",
    items: [
      { href: "/admin/content", label: "網站內容", icon: FileText },
      { href: "/admin/slides", label: "首頁輪播", icon: Images },
      { href: "/admin/coaches", label: "教練", icon: Dumbbell },
      { href: "/admin/site-settings", label: "外觀設定", icon: Palette },
    ],
  },
  {
    title: "系統",
    items: [
      // 只在追查問題時看 → 視覺弱化（不隱藏）
      { href: "/admin/audit-log", label: "操作紀錄", icon: ScrollText, muted: true },
    ],
  },
];

/**
 * 桌面側欄的列高與分組標題間距（像素）。
 *
 * 這兩個數字是「14 項在 1440×900 不需滾動」的唯一來源，改動前請重算：
 *   14 × 34 + 6 × (~19) + 容器上下 padding 16 ≈ 606px
 *   容器 `md:max-h-[calc(100dvh-5rem)]`（900vh → 820px）→ 不觸發內部滾動；
 *   自然位置（admin/layout.tsx 的 md:pt-[5.5rem] = 88px）下最後一項
 *   bottom ≈ 700 < 900。
 */
const ITEM_H = "h-[34px]";
const GROUP_TITLE_BASE =
  "px-3 pb-0.5 text-[11px] font-bold leading-none tracking-[0.14em] text-white/45";

/** 待審核項的數字徽章：查詢失敗 → 「—」，不假裝 0 */
function PendingBadge({
  value,
  active,
}: {
  value: number | null;
  active: boolean;
}) {
  const text = value === null ? "—" : String(value);
  const tone =
    value === null
      ? "bg-white/5 text-white/45"
      : value > 0
        ? active
          ? "bg-white/25 text-white"
          : "bg-vital-bright/15 text-vital-bright"
        : active
          ? "bg-white/15 text-white/70"
          : "bg-white/5 text-white/45";
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums leading-none ${tone}`}
      aria-label={value === null ? "待處理件數讀取失敗" : `待處理 ${value} 件`}
    >
      {text}
    </span>
  );
}

function isActive(item: NavItem, pathname: string): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(item.href + "/");
}

const subscribeNoop = () => () => {};

export function AdminNav({
  pendingTotal = null,
}: {
  /**
   * 「待審核」的總待處理數（四類相加）。
   * null = 任一分項查詢失敗或未連接 DB → 顯示「—」。
   */
  pendingTotal?: number | null;
}) {
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

  /** 「待審核」項要顯示數字；其他項不顯示 */
  const pendingFor = (item: NavItem): number | null | undefined =>
    item.href === "/admin/review" ? pendingTotal : undefined;

  return (
    <>
      {/* ===== 手機：56px 列（不佔首屏），點選單開抽屜 ===== */}
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
                    {/* 14 項 × 44px + 6 個標題 ≈ 810px：分組標題收成 pt-3 pb-1，
                        令 390×844 只需極短滾動（20 項時代要滑 1.5 屏） */}
                    <p className="px-3 pt-3 pb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
                      {group.title}
                    </p>
                    <ul>
                      {group.items.map((item) => {
                        const active = isActive(item, pathname);
                        const Icon = item.icon;
                        const badge = pendingFor(item);
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
                              {badge !== undefined ? (
                                <PendingBadge value={badge} active={active} />
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
                const badge = pendingFor(item);
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
                      {badge !== undefined ? (
                        <PendingBadge value={badge} active={active} />
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
