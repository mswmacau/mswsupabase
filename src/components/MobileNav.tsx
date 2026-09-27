"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Shield, Ticket, User, X } from "lucide-react";
import { LogoutButton } from "./LogoutButton";

interface Props {
  links: { href: string; label: string }[];
  isLoggedIn: boolean;
  isAdmin?: boolean;
  displayName?: string | null;
  points?: number;
  brandName?: string;
  brandNameEn?: string;
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
}: Props) {
  // 以「開啟時的路徑」推導開啟狀態：換頁後 open 自動變 false，
  // 不需要在 effect 裡 setState（避免連鎖 render）。
  const [openPath, setOpenPath] = useState<string | null>(null);
  const pathname = usePathname();
  const open = openPath !== null && openPath === pathname;

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

      {open && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-ink/95 backdrop-blur-xl md:hidden">
          {/* 手工質感：細網格 + 噪點 */}
          <div className="grid-lines absolute inset-0" />
          <div className="noise-overlay" />

          <div className="relative flex items-center justify-between border-b border-white/10 px-5 py-4">
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
            {links.map((l, i) => {
              const active =
                pathname === l.href || pathname.startsWith(l.href + "/");
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
                  {l.label}
                  {active && (
                    <span
                      aria-hidden
                      className="absolute bottom-0 left-0 h-[2px] w-10 bg-vital-bright"
                    />
                  )}
                </Link>
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
                  <Link href="/signup" className="btn-base btn-vital btn-slab min-h-11">
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
        </div>
      )}
    </>
  );
}
