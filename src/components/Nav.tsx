"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, Shield, User } from "lucide-react";
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
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-ink-line bg-ink/95 backdrop-blur-md"
          : "bg-gradient-to-b from-black/70 to-transparent"
      }`}
    >
      <div className="container-msw flex h-16 items-center justify-between gap-4 md:h-20">
        <Link href="/" className="group flex items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={brandName}
              className="h-10 w-auto"
            />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-vital text-sm font-black tracking-tight text-white shadow-lg shadow-vital/30">
              MSW
            </span>
          )}
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="text-[15px] font-extrabold tracking-wide">
              {brandName}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/50">
              {brandNameEn}
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-white/10 text-white"
                    : "text-white/70 hover:bg-white/5 hover:text-white"
                }`}
              >
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
                onClick={() => setMenuOpenPath((prev) => (prev === pathname ? null : pathname))}
                className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 py-1.5 pl-2 pr-3 text-sm font-semibold transition hover:border-white/40"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cobalt text-xs font-bold">
                  {(displayName ?? "M").slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-[110px] truncate">
                  {displayName ?? "會員"}
                </span>
                <span className="text-[11px] font-bold text-vital">
                  {points} pt
                </span>
                <ChevronDown size={14} className="text-white/60" />
              </button>

              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setMenuOpenPath(null)}
                  />
                  <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border border-ink-line bg-ink-soft py-1.5 shadow-2xl">
                    <Link
                      href="/dashboard"
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-white/85 hover:bg-white/5"
                    >
                      <User size={15} /> 我的帳戶
                    </Link>
                    <Link
                      href="/dashboard/coupons"
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-white/85 hover:bg-white/5"
                    >
                      🎟️ 我的優惠券
                    </Link>
                    {isAdmin && (
                      <Link
                        href="/admin"
                        className="flex items-center gap-2 px-4 py-2.5 text-sm text-white/85 hover:bg-white/5"
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
                className="hidden rounded-full px-4 py-2 text-sm font-semibold text-white/80 transition hover:text-white md:block"
              >
                會員登入
              </Link>
              <Link href="/signup" className="btn-base btn-vital !px-5 !py-2 text-sm">
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
