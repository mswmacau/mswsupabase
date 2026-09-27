"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, Shield, Ticket, User } from "lucide-react";
import { BRAND, NAV_LINKS } from "@/lib/config";
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
}

/** 斜切角尺寸：小元件用較小的切角，避免切掉過多面積 */
const CUT_SM = { "--cut": "8px" } as CSSProperties;
const CUT_MD = { "--cut": "14px" } as CSSProperties;

export function Nav({
  isLoggedIn,
  isAdmin,
  displayName,
  points,
  logoUrl,
  brandName = BRAND.name,
  brandNameEn = BRAND.nameEn,
}: Props) {
  const [scrolled, setScrolled] = useState(false);
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

  const links = NAV_LINKS.map((l) => ({ ...l }));

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-all duration-300 ${
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
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`group relative isolate inline-flex min-h-11 items-center px-4 text-sm font-semibold transition-colors duration-300 ${
                  active ? "text-white" : "text-white/70 hover:text-white"
                }`}
              >
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
                {l.label}
              </Link>
            );
          })}
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
                className="btn-base btn-vital btn-slab min-h-11 !px-5 !py-2 text-sm"
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
          />
        </div>
      </div>
    </header>
  );
}
