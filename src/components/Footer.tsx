import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, AtSign, Mail, MapPin, Shield } from "lucide-react";
import { BRAND, NAV_LINKS, RULES } from "@/lib/config";

/** 聯絡方式：以細分隔線逐條列出，不做等寬欄位堆砌 */
type ContactItem = {
  icon: ReactNode;
  text: string;
  /** 有 href 才渲染成連結；external 為真時另開視窗並加外部連結箭頭 */
  href?: string;
  external?: boolean;
};

const CONTACT: readonly ContactItem[] = [
  { icon: <MapPin size={16} aria-hidden />, text: BRAND.location },
  {
    icon: <Mail size={16} aria-hidden />,
    text: BRAND.email,
    href: `mailto:${BRAND.email}`,
  },
  {
    icon: <AtSign size={16} aria-hidden />,
    text: BRAND.instagram,
    href: BRAND.instagramUrl,
    external: true,
  },
];

/** 未登入顯示註冊／登入；已登入只顯示會員專區，並用「管理員入口」進後台 */
export function Footer({
  isLoggedIn = false,
  isAdmin = false,
  brandName = BRAND.name,
  brandNameEn = BRAND.nameEn,
}: {
  isLoggedIn?: boolean;
  isAdmin?: boolean;
  brandName?: string;
  brandNameEn?: string;
}) {
  return (
    <footer className="relative overflow-hidden border-t border-ink-line bg-ink">
      {/* 手工質感：細網格 + 噪點 */}
      <div className="grid-lines absolute inset-0" />
      <div className="noise-overlay" />

      <div className="container-msw relative">
        {/* ===== 品牌宣言：大字主導，不是三欄連結堆砌 ===== */}
        <div className="grid gap-10 py-14 lg:grid-cols-[1.7fr_1fr] lg:gap-16 lg:py-20">
          <div>
            <span className="eyebrow">Macau Street Workout</span>

            <h2 className="display-xl mt-6">
              <span className="block text-white">用自身的重量</span>
              <span className="mt-1 block text-outline">練出澳門</span>
              <span className="mt-1 block text-vital-bright">最強街頭力量</span>
            </h2>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <span className="slab inline-flex -skew-x-6 items-center border border-white/15 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-white/70">
                Mon {RULES.TRAINING_TIME}
              </span>
              <span className="slab inline-flex -skew-x-6 items-center border border-vital/40 bg-vital/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-vital-bright">
                {RULES.MONTHLY_GOAL_KM} km / month
              </span>
            </div>

            {/* 品牌介紹：宣言式排版，四行各自獨立成行，不做卡片堆疊 */}
            <div className="mt-8 max-w-lg">
              <p className="text-lg font-extrabold leading-snug text-white sm:text-xl">
                {BRAND.intro[0]}
              </p>
              <p className="mt-3 text-xs font-semibold tracking-[0.12em] text-[var(--text-muted)]">
                {BRAND.intro[1]}
              </p>
              <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--text-faint)]">
                {BRAND.intro[2]}
              </p>
              {/* 收尾宣言：描邊字獨立一行，不與其他行共用行框（避免被斷行切割） */}
              <p className="mt-6 block text-xl font-black leading-tight tracking-[-0.01em] text-outline sm:text-3xl">
                {BRAND.intro[3]}
              </p>
            </div>
          </div>

          {/* 豎排標籤 + 聯絡方式 */}
          <div className="flex gap-6 lg:justify-end">
            <span className="vlabel hidden text-white/40 sm:block">
              Train · Run · Earn
            </span>
            <ul className="space-y-2 text-sm text-white/75">
              {CONTACT.map((c) => (
                <li key={c.text}>
                  {c.href ? (
                    <a
                      href={c.href}
                      target={c.external ? "_blank" : undefined}
                      rel={c.external ? "noopener noreferrer" : undefined}
                      className="group inline-flex min-h-11 max-w-full items-center gap-2.5 transition-colors hover:text-vital-bright"
                    >
                      <span className="flex-none text-vital-bright">
                        {c.icon}
                      </span>
                      <span className="min-w-0 break-all">{c.text}</span>
                      {c.external && (
                        <>
                          <ArrowUpRight
                            size={13}
                            aria-hidden
                            className="flex-none opacity-60 transition-opacity group-hover:opacity-100"
                          />
                          <span className="sr-only">（另開新視窗）</span>
                        </>
                      )}
                    </a>
                  ) : (
                    <span className="inline-flex min-h-11 items-center gap-2.5">
                      <span className="flex-none text-vital-bright">
                        {c.icon}
                      </span>
                      <span>{c.text}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ===== 細分隔線 + 必要連結（橫向節奏，非欄位堆砌） ===== */}
        <div className="grid gap-6 border-t border-[var(--line-fine)] py-7 md:grid-cols-[1fr_auto] md:items-center">
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="inline-flex min-h-11 items-center text-sm font-semibold text-white/75 transition hover:text-vital-bright"
              >
                {l.label}
              </Link>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-7 gap-y-2 md:border-l md:border-[var(--line-fine)] md:pl-7">
            {!isLoggedIn && (
              <>
                <Link
                  href="/signup"
                  className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-white/75 transition hover:text-vital-bright"
                >
                  註冊會員 <ArrowUpRight size={14} />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-white/75 transition hover:text-vital-bright"
                >
                  會員登入
                </Link>
              </>
            )}
            {isLoggedIn && (
              <>
                <Link
                  href="/dashboard"
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-white/75 transition hover:text-vital-bright"
                >
                  我的帳戶
                </Link>
                <Link
                  href="/dashboard/coupons"
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-white/75 transition hover:text-vital-bright"
                >
                  我的優惠券
                </Link>
              </>
            )}
            {isAdmin && (
              <Link
                href="/admin"
                className="inline-flex min-h-11 items-center text-sm font-semibold text-white/75 transition hover:text-vital-bright"
              >
                後台管理
              </Link>
            )}
          </div>
        </div>

        {/* ===== 底欄 ===== */}
        <div className="flex flex-col items-start justify-between gap-3 border-t border-[var(--line-fine)] py-6 text-xs text-white/60 sm:flex-row sm:items-center">
          <span>
            © {new Date().getFullYear()} {brandName} · {brandNameEn}
          </span>
          <div className="flex flex-wrap items-center gap-5">
            <Link
              href="/admin"
              className="inline-flex min-h-11 items-center gap-1.5 transition hover:text-white"
            >
              <Shield size={13} /> 管理員入口
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
