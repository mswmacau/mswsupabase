"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Gift, Shield, Ticket, User } from "lucide-react";
import { BRAND } from "@/lib/config";
import { DEFAULT_NAV, type NavLink } from "@/lib/content";
import { useSmartNav } from "./fx/useSmartNav";
import { MobileNav } from "./MobileNav";
import { LogoutButton } from "./LogoutButton";

interface Props {
  isLoggedIn: boolean;
  isAdmin: boolean;
  displayName: string | null;
  points: number;
  logoUrl?: string | null;
  brandName?: string;
  brandNameEn?: string;
  /** 導覽選單（site_nav；由 layout 以 getSiteNav() 讀出後傳入） */
  navLinks?: NavLink[];
  /** app_settings.rewards_enabled；false 時隱藏禮品換領入口 */
  rewardsEnabled?: boolean;
}

/** 斜切角尺寸：小元件用較小的切角，避免切掉過多面積 */
const CUT_SM = { "--cut": "8px" } as CSSProperties;
const CUT_MD = { "--cut": "14px" } as CSSProperties;

/** 選單項目是否處於「當前頁」：本身或其子項命中即算（子項在子選單內仍要標示父項） */
function isNavActive(link: NavLink, pathname: string): boolean {
  const hit = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);
  if (hit(link.href)) return true;
  return (link.children ?? []).some((c) => hit(c.href));
}

/**
 * 桌面導覽的單一項目。
 *
 * 有子項時＝「父項連結 + 展開鈕 + 下拉」：
 *  - 父項 Link 照舊導航到父頁（「活動」→ /events），不因為有子選單而失去入口
 *  - 展開鈕獨立存在，aria-haspopup / aria-expanded / aria-controls 掛在它身上
 *  - 滑鼠 hover 展開、鍵盤 focus 到父項或展開鈕時展開、Esc 收起並把焦點還給展開鈕
 *  - 下拉與觸發鈕之間用外層容器的 pt-2 內距相接（不是下拉的 mt-2），
 *    這樣滑鼠橫越中間空白時 hover 不會中斷（紅色要求：hover 留白不能消失）
 */
function DesktopNavItem({
  link,
  pathname,
}: {
  link: NavLink;
  pathname: string;
}) {
  const rawId = useId();
  const panelId = `navsub-${rawId.replace(/[^a-zA-Z0-9-]/g, "")}`;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /**
   * Esc 收起後會把焦點送回展開鈕，但展開鈕的 onFocus 又會把它打開——
   * 用一個一次性旗標吃掉那次 focus，才不會「按 Esc 反而彈更開」。
   */
  const skipFocusOpenRef = useRef(false);
  const children = link.children ?? [];
  const hasChildren = children.length > 0;
  const active = isNavActive(link, pathname);

  const itemClass = `group relative isolate inline-flex min-h-11 items-center px-4 text-sm font-semibold transition-colors duration-300 ${
    active ? "text-white" : "text-white/70 hover:text-white"
  }`;

  if (!hasChildren) {
    return (
      <Link
        href={link.href}
        aria-current={active ? "page" : undefined}
        className={itemClass}
      >
        <NavItemDecor active={active} />
        {link.label}
      </Link>
    );
  }

  return (
    <div
      className="relative flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          skipFocusOpenRef.current = true;
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
      onBlur={(e) => {
        // 焦點離開整個項目（含下拉）才收起
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <Link
        href={link.href}
        aria-current={active ? "page" : undefined}
        onFocus={() => setOpen(true)}
        className={`${itemClass} pr-1`}
      >
        <NavItemDecor active={active} />
        {link.label}
      </Link>

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`展開「${link.label}」子選單`}
        onFocus={() => {
          if (skipFocusOpenRef.current) {
            skipFocusOpenRef.current = false;
            return;
          }
          setOpen(true);
        }}
        onClick={() => setOpen((v) => !v)}
        className="mr-1 inline-flex h-11 w-7 flex-none items-center justify-center text-white/60 transition-colors hover:text-white"
      >
        <ChevronDown
          size={14}
          aria-hidden
          className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div id={panelId} className="absolute left-0 top-full z-50 pt-2">
          <ul
            style={CUT_MD}
            className="clip-notch-br min-w-52 border border-ink-line bg-ink-soft py-1.5 shadow-2xl backdrop-blur-xl"
          >
            {children.map((c) => {
              const childActive =
                pathname === c.href || pathname.startsWith(`${c.href}/`);
              return (
                <li key={c.href}>
                  <Link
                    href={c.href}
                    aria-current={childActive ? "page" : undefined}
                    className={`flex min-h-11 items-center px-4 text-sm transition-colors ${
                      childActive
                        ? "bg-white/[0.06] text-vital-bright"
                        : "text-white/85 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {c.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 當前項的斜切 slab 底 + 底部實線（父項與單層項目共用，避免樣式漂移） */
function NavItemDecor({ active }: { active: boolean }) {
  return (
    <>
      <span
        aria-hidden
        className={`clip-slab absolute inset-0 -z-10 transition-opacity duration-300 ${
          active
            ? "bg-white/10 opacity-100"
            : "bg-white/[0.06] opacity-0 group-hover:opacity-100"
        }`}
      />
      <span
        aria-hidden
        className={`absolute inset-x-0 bottom-0 h-[2px] transition-opacity duration-300 ${
          active ? "bg-vital-bright opacity-100" : "opacity-0"
        }`}
      />
    </>
  );
}

export function Nav({
  isLoggedIn,
  isAdmin,
  displayName,
  points,
  logoUrl,
  brandName = BRAND.name,
  brandNameEn = BRAND.nameEn,
  navLinks,
  rewardsEnabled = true,
}: Props) {
  const [scrolled, setScrolled] = useState(false);
  // F-G1：向下碌收起、向上碌／碌返頂部重現（reduced-motion 時恆為 false）
  const hidden = useSmartNav();
  // 以「開啟時的路徑」推導選單狀態：換頁後自動關閉，不需要在 effect 裡 setState
  const [menuOpenPath, setMenuOpenPath] = useState<string | null>(null);
  const pathname = usePathname();
  const menuOpen = menuOpenPath !== null && menuOpenPath === pathname;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // T-6：選單改讀 site_nav（layout 傳入）；未傳入時回落 DEFAULT_NAV
  // （不再回落 config 的 NAV_LINKS——那是收斂前的 7 項平級結構）。
  // visible=false 的項目保留在資料中但不顯示（桌面與手機選單同步），
  // 子項也做同樣的過濾；過濾後沒有子項的父項不再帶 children（避免空下拉）。
  // 2026 導覽收斂：/hyrox 已是 site_nav 的正式子項，元件層不再注入。
  const source: NavLink[] = navLinks ?? DEFAULT_NAV.links;
  const links: NavLink[] = source
    .filter((l) => l.visible)
    .map((l) => {
      const children = (l.children ?? [])
        .filter((c) => c.visible)
        .map((c) => ({ href: c.href, label: c.label, visible: true }));
      return children.length > 0
        ? { href: l.href, label: l.label, visible: true, children }
        : { href: l.href, label: l.label, visible: true };
    });

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-all duration-300 ${
        hidden ? "-translate-y-full" : "translate-y-0"
      } ${
        scrolled
          ? "glass"
          : "border-b-transparent bg-gradient-to-b from-black/70 to-transparent backdrop-blur-[14px] backdrop-saturate-[130%]"
      }`}
    >
      <div className="container-msw flex h-16 items-center justify-between gap-4 md:h-20">
        <Link href="/" className="group flex items-center gap-3">
          {logoUrl ? (
            // width/height = 原圖 1015×1024 的固有尺寸：載入前就讓瀏覽器
            // 推出正確寬高比，避免 CLS；實際顯示仍由 h-10 w-auto 控制（40px 高）。
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={brandName}
              width={1015}
              height={1024}
              decoding="async"
              fetchPriority="high"
              className="h-10 w-auto"
            />
          ) : (
            <span
              style={CUT_SM}
              className="clip-notch flex h-10 w-10 flex-none items-center justify-center bg-vital text-sm font-black tracking-tight text-white"
            >
              MSW
            </span>
          )}
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="text-[15px] font-extrabold tracking-wide">
              {brandName}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/70">
              {brandNameEn}
            </span>
          </span>
        </Link>

        {/* 去膠囊化：當前項用斜切 slab + 底部實線標示，不再是圓角填充 */}
        <nav className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <DesktopNavItem key={l.href} link={l} pathname={pathname} />
          ))}
        </nav>

        <div className="flex items-center gap-2 md:gap-3">
          {isLoggedIn ? (
            <div className="relative hidden md:block">
              <button
                type="button"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpenPath((prev) => (prev === pathname ? null : pathname))}
                className="clip-slab flex min-h-11 items-center gap-2 border border-white/15 bg-white/5 pl-2 pr-3 text-sm font-semibold transition hover:border-white/40"
              >
                <span
                  style={CUT_SM}
                  className="clip-notch flex h-7 w-7 flex-none items-center justify-center bg-cobalt text-xs font-bold"
                >
                  {(displayName ?? "M").slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-[110px] truncate">
                  {displayName ?? "會員"}
                </span>
                <span className="stat-figure text-[11px] font-bold text-vital-bright">
                  {points} pt
                </span>
                <ChevronDown size={14} className="text-white/75" />
              </button>

              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setMenuOpenPath(null)}
                  />
                  <div
                    style={CUT_MD}
                    className="clip-notch-br absolute right-0 z-50 mt-2 w-52 border border-ink-line bg-ink-soft py-1.5 shadow-2xl backdrop-blur-xl"
                  >
                    <Link
                      href="/dashboard"
                      className="flex min-h-11 items-center gap-2 px-4 text-sm text-white/85 hover:bg-white/10"
                    >
                      <User size={15} /> 我的帳戶
                    </Link>
                    <Link
                      href="/dashboard/coupons"
                      className="flex min-h-11 items-center gap-2 px-4 text-sm text-white/85 hover:bg-white/10"
                    >
                      <Ticket size={15} /> 我的優惠券
                    </Link>
                    {rewardsEnabled && (
                      <Link
                        href="/dashboard/rewards"
                        className="flex min-h-11 items-center gap-2 px-4 text-sm text-white/85 hover:bg-white/10"
                      >
                        <Gift size={15} /> 禮品換領
                      </Link>
                    )}
                    {isAdmin && (
                      <Link
                        href="/admin"
                        className="flex min-h-11 items-center gap-2 px-4 text-sm text-white/85 hover:bg-white/10"
                      >
                        <Shield size={15} /> 後台管理
                      </Link>
                    )}
                    <LogoutButton className="px-4 py-2.5" />
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <Link
                href="/login"
                className="group relative isolate hidden min-h-11 items-center px-4 text-sm font-semibold text-white/80 transition-colors hover:text-white md:inline-flex"
              >
                <span
                  aria-hidden
                  className="clip-slab absolute inset-0 -z-10 bg-white/[0.06] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                />
                會員登入
              </Link>
              <Link
                href="/signup"
                // E08 按下回饋：只喺未帶 data-fx-magnet / data-fx-tilt 嘅元素上加（紅線 8）
                // 用 Tailwind v4 嘅 `scale` 獨立合成屬性，唔會同 hover 嘅 transform 打架
                className="btn-base btn-vital btn-slab min-h-11 !px-5 !py-2 text-sm active:scale-[0.97] active:duration-100"
              >
                立即加入
              </Link>
            </>
          )}

          <MobileNav
            links={links}
            isLoggedIn={isLoggedIn}
            isAdmin={isAdmin}
            displayName={displayName}
            points={points}
            brandName={brandName}
            brandNameEn={brandNameEn}
            rewardsEnabled={rewardsEnabled}
          />
        </div>
      </div>
    </header>
  );
}
