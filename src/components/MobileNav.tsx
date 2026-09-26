"use client";

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

export function MobileNav({
  links,
  isLoggedIn,
  isAdmin = false,
  displayName = null,
  points = 0,
  brandName = "MSW 街健館",
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
        onClick={() => setOpenPath(pathname)}
        className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 md:hidden"
      >
        <Menu size={22} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-ink/95 backdrop-blur-sm md:hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-lg font-extrabold tracking-tight">
              {brandName}
            </span>
            <button
              type="button"
              aria-label="關閉選單"
              onClick={() => setOpenPath(null)}
              className="rounded-lg p-2 text-white/80 transition hover:bg-white/10"
            >
              <X size={22} />
            </button>
          </div>

          {isLoggedIn && (
            <div className="mx-5 mb-2 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cobalt text-sm font-bold">
                {(displayName ?? "M").slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">
                  {displayName ?? "會員"}
                </div>
                <div className="text-xs text-white/45">{points} pt</div>
              </div>
            </div>
          )}

          <nav className="flex flex-col gap-1 px-5 pt-4">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="border-b border-white/10 py-4 text-xl font-semibold text-white/90"
              >
                {l.label}
              </Link>
            ))}

            <div className="mt-6 flex flex-col gap-3">
              {isLoggedIn ? (
                <>
                  <Link href="/dashboard" className="btn-base btn-cobalt">
                    <User size={17} /> 我的帳戶
                  </Link>
                  <Link href="/dashboard/coupons" className="btn-base btn-ghost">
                    <Ticket size={17} /> 我的優惠券
                  </Link>
                  {isAdmin && (
                    <Link href="/admin" className="btn-base btn-ghost">
                      <Shield size={17} /> 後台管理
                    </Link>
                  )}
                  <LogoutButton className="btn-base btn-ghost justify-center !text-red-300" />
                </>
              ) : (
                <>
                  <Link href="/login" className="btn-base btn-ghost">
                    會員登入
                  </Link>
                  <Link href="/signup" className="btn-base btn-vital">
                    立即加入
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
