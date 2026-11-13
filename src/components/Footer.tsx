import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, AtSign, Mail, MapPin, Shield } from "lucide-react";
import { BRAND } from "@/lib/config";
import type { NextSessionInfo } from "@/lib/types";
import { DEFAULT_CONTACT, DEFAULT_NAV, type NavLink, type SiteContact } from "@/lib/content";

/** 聯絡方式：以細分隔線逐條列出，不做等寬欄位堆砌 */
type ContactItem = {
  icon: ReactNode;
  text: string;
  /** 有 href 才渲染成連結；external 為真時另開視窗並加外部連結箭頭 */
  href?: string;
  external?: boolean;
};

/** 由 site_contact（頁尾聯絡）組成聯絡清單；未傳入時回落 config 的 BRAND 現值 */
function contactItems(contact: SiteContact): ContactItem[] {
  return [
    { icon: <MapPin size={16} aria-hidden />, text: contact.location },
    {
      icon: <Mail size={16} aria-hidden />,
      text: contact.email,
      href: `mailto:${contact.email}`,
    },
    {
      icon: <AtSign size={16} aria-hidden />,
      text: contact.instagram,
      href: contact.instagram_url,
      external: true,
    },
  ];
}

/** 未登入顯示註冊／登入；已登入只顯示會員專區，並用「管理員入口」進後台 */
export function Footer({
  isLoggedIn = false,
  isAdmin = false,
  brandName = BRAND.name,
  brandNameEn = BRAND.nameEn,
  contact = DEFAULT_CONTACT,
  navLinks,
}: {
  isLoggedIn?: boolean;
  isAdmin?: boolean;
  brandName?: string;
  brandNameEn?: string;
  /** 頁尾聯絡三項（地點／Email／Instagram；site_contact；layout 以 getSiteContact() 傳入） */
  contact?: SiteContact;
  /** 導覽選單（site_nav；visible=false 不顯示） */
  navLinks?: NavLink[];
  /**
   * @deprecated 頁尾已不再顯示「下一場訓練」徽章（2026-11 頁尾精簡），
   * 元件不讀取此 prop；保留是為了讓 `src/app/layout.tsx` 的呼叫端不必改動。
   * 後續若清理 layout，可連同 getNextSession() 一起移除。
   */
  nextSession?: NextSessionInfo | null;
}) {
  const CONTACT = contactItems(contact);
  // 選單顯隱與導覽列同步：隱藏的項目在頁尾導航行一併不顯示。
  // 2026 導覽收斂後「活動」底下多了子項，頁尾一律攤平列出（父子都列），
  // 否則 /hyrox、/training、/run 會從頁尾消失。
  const footerLinks = (navLinks ?? DEFAULT_NAV.links)
    .filter((l) => l.visible)
    .flatMap((l) => [
      { href: l.href, label: l.label },
      ...(l.children ?? [])
        .filter((c) => c.visible)
        .map((c) => ({ href: c.href, label: c.label })),
    ]);
  return (
    <footer className="relative overflow-hidden border-t border-ink-line bg-ink">
      {/* 手工質感：細網格 + 噪點 */}
      <div className="grid-lines absolute inset-0" />
      <div className="noise-overlay" />

      <div className="container-msw relative">
        {/*
          ===== 聯絡資訊 + 連結分層（2026-11 頁尾精簡）=====
          站主反映「每個頁面底部都有同一組多餘的東西」。原本左欄是：
            三行大字標語（用自身的重量／練出澳門／最強街頭力量）
            ＋兩顆徽章（下一場訓練時段、月跑量）
            ＋四行品牌介紹（contact.intro[0..3]）
            ＋直排字 Train · Run · Earn
          這組文案與首頁 hero 完全同義，且每一頁都重複，因此整塊移除。

          移除後頁尾只留「功能性內容」：聯絡資訊、三層連結、版權列。
          ⚠️ config 的 tagline 與 content 的 intro **沒有刪**（首頁 hero 與
             /about 仍在用），只是頁尾不再呈現。
        */}
        <div className="grid gap-8 py-10 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:gap-10 md:py-12">
          {/* 左欄：聯絡方式 —— 頁尾存在的理由，必須保留 */}
          <div className="md:border-t md:border-[var(--line-fine)] md:pt-6">
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

          {/* 右欄：三層連結（分組、文案、間距、權重全部原樣保留） */}
          <div className="md:border-l md:border-[var(--line-fine)] md:pl-10">
            {/*
              ===== 頁尾連結分層（2026-09-29 重構）=====
              站主反映「下拉到底部時分類不清」。原本三種性質不同的連結
              （導覽／會員動作／管理）全部平鋪在同一條水平線上、權重相同。

              重構做法：拆成三個獨立區塊，各自有分隔線與不同的視覺權重：
                ① 導覽類   — 正常權重
                ② 會員類   — 左側紅色標記線，凸顯這是「動作」不是「瀏覽」
                ③ 管理類   — 最低權重（僅管理員可見），且下沈到最底部

              ⚠️ 文案凍結：本區塊**沒有新增任何一個字**，全部沿用既有文案，
                 只調整分組、間距與視覺權重。
            */}

            {/* ① 導覽類 */}
            <div className="border-t border-[var(--line-fine)] py-6">
              <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
                {footerLinks.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="inline-flex min-h-11 items-center text-sm font-semibold text-white/75 transition hover:text-vital-bright"
                  >
                    {l.label}
                  </Link>
                ))}
                {/* F-G3：站主要求額外加嘅獨立連結（內部連結，唔開新視窗） */}
                <Link
                  href="/about"
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-white/75 transition hover:text-vital-bright"
                >
                  聯絡我們
                </Link>
                {/* 私隱政策：Google OAuth 同意畫面需要一個公開可達的政策頁 */}
                <Link
                  href="/privacy"
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-white/75 transition hover:text-vital-bright"
                >
                  私隱政策
                </Link>
              </div>
            </div>

            {/* ② 會員類：左側紅色標記線，與導覽區做出區隔 */}
            <div className="border-t border-[var(--line-fine)] py-6">
              <div className="flex flex-wrap items-center gap-x-7 gap-y-2 md:border-l-2 md:border-vital/45 md:pl-6">
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
              </div>
            </div>

            {/* ③ 管理類：僅管理員可見，刻意用最低視覺權重並下沈到最底 */}
            {isAdmin && (
              <div className="border-t border-[var(--line-fine)] py-5">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 md:border-l md:border-[var(--line-fine)] md:pl-6">
                  <Link
                    href="/admin"
                    className="inline-flex min-h-11 items-center text-xs font-semibold text-white/45 transition hover:text-white/75"
                  >
                    後台管理
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ===== 底欄 ===== */}
        <div className="flex flex-col items-start justify-between gap-3 border-t border-[var(--line-fine)] py-6 text-xs text-white/60 sm:flex-row sm:items-center">
          <span>
            © {new Date().getFullYear()} {brandName} · {brandNameEn}
          </span>
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-5">
              <Link
                href="/admin"
                className="inline-flex min-h-11 items-center gap-1.5 transition hover:text-white"
              >
                <Shield size={13} /> 管理員入口
              </Link>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
