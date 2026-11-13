"use client";

import type { CSSProperties } from "react";
import { useEffect, useId, useSyncExternalStore, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  ChevronDown,
  Gift,
  Menu,
  Shield,
  Ticket,
  User,
  X,
} from "lucide-react";
import type { NavLink } from "@/lib/content";
import { LogoutButton } from "./LogoutButton";

interface Props {
  links: NavLink[];
  isLoggedIn: boolean;
  isAdmin?: boolean;
  displayName?: string | null;
  points?: number;
  brandName?: string;
  brandNameEn?: string;
  /** app_settings.rewards_enabled；false 時隱藏禮品換領入口 */
  rewardsEnabled?: boolean;
}

/** 斜切角尺寸 */
const CUT_SM = { "--cut": "8px" } as CSSProperties;
const CUT_MD = { "--cut": "18px" } as CSSProperties;

export function MobileNav({
  links,
  isLoggedIn,
  isAdmin = false,
  displayName = null,
  points = 0,
  brandName = "MSW 街健館",
  brandNameEn = "Macau Street Workout",
  rewardsEnabled = true,
}: Props) {
  // 以「開啟時的路徑」推導開啟狀態：換頁後 open 自動變 false，
  // 不需要在 effect 裡 setState（避免連鎖 render）。
  const [openPath, setOpenPath] = useState<string | null>(null);
  const pathname = usePathname();
  const open = openPath !== null && openPath === pathname;

  // 子選單 accordion：同一時間只展開一組（父項 href 作為 key）
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");

  /**
   * 是否已掛載（client-only）。
   *
   * ⚠️ 修復重點：遮罩必須用 createPortal 渲染到 <body>，不能留在 <header> 內。
   * 原因：<header> 帶有 backdrop-filter（未捲動 backdrop-blur-[14px]、捲動後 .glass
   * 的 blur(16px) saturate(140%)），而帶 filter / backdrop-filter 的元素會成為其
   * position:fixed 後代的 containing block。若遮罩留在 header 內，它的 inset-0
   * 就只對齊那個 64px 高的導覽列，而非整個視窗 → 使用者點開選單卻看不到任何內容。
   * 實測（Chromium 390×844）：留在 header 內時遮罩高度僅 64px；portal 到 body 後
   * 變為 844×390，正常顯示。
   *
   * mounted 只在 client mount 後才為 true，確保 SSR 與首次 hydration 輸出一致。
   *
   * 實現同 MotionRoot.useMotionReady()：用 useSyncExternalStore 而唔用
   * useState + useEffect —— effect 入面同步 setState 會觸發連鎖 render
   * （eslint react-hooks/set-state-in-effect）；getServerSnapshot 永遠 false、
   * getSnapshot 永遠 true，React 喺 hydration 之後自己切過去，語意一樣。
   */
  const subscribeNoop = () => () => {};
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true, // client：hydration 後為 true
    () => false // SSR / 首次 hydration：false
  );

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="開啟選單"
        aria-expanded={open}
        onClick={() => setOpenPath(pathname)}
        className="clip-slab inline-flex min-h-11 min-w-11 items-center justify-center bg-white/5 text-white/80 transition hover:bg-white/10 md:hidden"
      >
        <Menu size={22} />
      </button>

      {open && mounted ? (
        createPortal(
          <div className="fixed inset-0 z-[60] overflow-y-auto bg-ink/95 backdrop-blur-xl md:hidden">
          {/* 手工質感：細網格 + 噪點 */}
          <div className="grid-lines absolute inset-0" />
          <div className="noise-overlay" />

          {/* 關閉鈕固定在頂部：子選單展開後內容變長、往下捲時仍看得到 */}
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-ink/95 px-5 py-4 backdrop-blur">
            <span className="text-lg font-extrabold tracking-tight">
              {brandName}
            </span>
            <button
              type="button"
              aria-label="關閉選單"
              onClick={() => setOpenPath(null)}
              className="clip-slab inline-flex min-h-11 min-w-11 items-center justify-center bg-white/5 text-white/80 transition hover:bg-white/10"
            >
              <X size={22} />
            </button>
          </div>

          {isLoggedIn && (
            <div className="relative mx-5 mt-5 flex items-center gap-3">
              <span
                style={CUT_SM}
                className="clip-notch flex h-9 w-9 flex-none items-center justify-center bg-cobalt text-sm font-bold"
              >
                {(displayName ?? "M").slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1 border-b border-white/10 pb-2">
                <div className="truncate font-semibold">
                  {displayName ?? "會員"}
                </div>
                <div className="stat-figure text-xs text-vital-bright">
                  {points} pt
                </div>
              </div>
            </div>
          )}

          <nav className="relative flex flex-col px-5 pt-4">
            {/*
              2026 導覽收斂：5 項，其中「活動」帶 3 個子項。
              有子項的項目＝一層 accordion 就地展開（不開二級抽屜、不跳新頁）。
              父列本身是展開控制（所以「點活動」＝展開），
              右側另留一個獨立的 icon 連到父頁（/events），
              否則父頁就從手機選單失去入口。圖示不帶可見文案。
            */}
            {links.map((l, i) => {
              const active =
                pathname === l.href ||
                pathname.startsWith(l.href + "/") ||
                (l.children ?? []).some(
                  (c) => pathname === c.href || pathname.startsWith(c.href + "/")
                );
              const children = l.children ?? [];

              if (children.length === 0) {
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex min-h-14 items-baseline gap-4 border-b border-white/10 text-xl font-semibold transition-colors ${
                      active ? "text-vital-bright" : "text-white/90"
                    }`}
                  >
                    <span className="stat-figure text-[11px] text-white/40">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{l.label}</span>
                    {active && (
                      <span
                        aria-hidden
                        className="absolute bottom-0 left-0 h-[2px] w-10 bg-vital-bright"
                      />
                    )}
                  </Link>
                );
              }

              const expanded = openGroup === l.href;
              const panelId = `mnav-${uid}-${i}`;
              return (
                <div key={l.href} className="border-b border-white/10">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={panelId}
                      onClick={() => setOpenGroup(expanded ? null : l.href)}
                      className={`relative flex min-h-14 min-w-0 flex-1 items-center gap-4 text-left text-xl font-semibold transition-colors ${
                        active ? "text-vital-bright" : "text-white/90"
                      }`}
                    >
                      <span className="stat-figure flex-none text-[11px] text-white/40">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{l.label}</span>
                      <ChevronDown
                        size={18}
                        aria-hidden
                        className={`flex-none text-white/50 transition-transform duration-300 ${
                          expanded ? "rotate-180" : ""
                        }`}
                      />
                      {active && (
                        <span
                          aria-hidden
                          className="absolute bottom-0 left-0 h-[2px] w-10 bg-vital-bright"
                        />
                      )}
                    </button>
                    {/* 父頁入口：不新增可見文案，只用圖示 + aria-label；
                        左側細分隔線把它與展開控制分開，避免兩個圖示讀成同一個按鈕 */}
                    <Link
                      href={l.href}
                      aria-label={`前往${l.label}頁`}
                      className="ml-1 inline-flex min-h-11 min-w-11 flex-none items-center justify-center border-l border-white/10 text-white/55 transition-colors hover:text-white"
                    >
                      <ArrowUpRight size={16} aria-hidden />
                    </Link>
                  </div>

                  {/* 0fr → 1fr 過場，不需要量高度；收起後仍留在 DOM 以便過場 */}
                  <div
                    id={panelId}
                    className="grid transition-[grid-template-rows] duration-300 ease-out"
                    style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
                  >
                    <div className="overflow-hidden">
                      <ul className="pb-2 pl-9">
                        {children.map((c) => {
                          const childActive =
                            pathname === c.href ||
                            pathname.startsWith(c.href + "/");
                          return (
                            <li key={c.href}>
                              <Link
                                href={c.href}
                                aria-current={childActive ? "page" : undefined}
                                tabIndex={expanded ? undefined : -1}
                                className={`flex min-h-11 items-center pr-2 text-base transition-colors ${
                                  childActive
                                    ? "font-semibold text-vital-bright"
                                    : "text-white/75 hover:text-white"
                                }`}
                              >
                                {c.label}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="mt-6 flex flex-col gap-3 pb-10">
              {isLoggedIn ? (
                <>
                  <Link href="/dashboard" className="btn-base btn-cobalt btn-slab min-h-11">
                    <User size={17} /> 我的帳戶
                  </Link>
                  <Link href="/dashboard/coupons" className="btn-base btn-ghost btn-slab min-h-11">
                    <Ticket size={17} /> 我的優惠券
                  </Link>
                  {rewardsEnabled && (
                    <Link href="/dashboard/rewards" className="btn-base btn-ghost btn-slab min-h-11">
                      <Gift size={17} /> 禮品換領
                    </Link>
                  )}
                  {isAdmin && (
                    <Link href="/admin" className="btn-base btn-ghost btn-slab min-h-11">
                      <Shield size={17} /> 後台管理
                    </Link>
                  )}
                  <LogoutButton className="btn-base btn-ghost btn-slab min-h-11 justify-center !text-red-300" />
                </>
              ) : (
                <>
                  <Link href="/login" className="btn-base btn-ghost btn-slab min-h-11">
                    會員登入
                  </Link>
                  {/* E08 按下回饋：只喺未帶 data-fx-magnet / data-fx-tilt 嘅元素上加（紅線 8） */}
                  <Link
                    href="/signup"
                    className="btn-base btn-vital btn-slab min-h-11 active:scale-[0.97] active:duration-100"
                  >
                    立即加入
                  </Link>
                </>
              )}

              <div
                style={CUT_MD}
                className="clip-notch-br mt-4 border border-white/10 px-4 py-3 text-[10px] uppercase tracking-[0.22em] text-white/45"
              >
                {brandNameEn}
              </div>
            </div>
          </nav>
          </div>,
          document.body,
        )
      ) : null}
    </>
  );
}
