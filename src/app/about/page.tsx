import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { getSiteContent, getSitePages } from "@/lib/queries";

/** T-19：頁面標題改讀 site_pages.about（DB 無值 → 回落預設＝現有硬編碼） */
export async function generateMetadata(): Promise<Metadata> {
  const pages = await getSitePages();
  return { title: pages.about.page_title };
}

export const dynamic = "force-dynamic";

/**
 * 關於我們（精簡導引頁）
 *
 * 站主要求「將關於我們移到教練團隊頁面的下方」，因此完整內容已搬到
 * `/coaches` 底部的「關於我們」區塊（`BrandIntro`，自帶 `id="about"`）。
 *
 * 本頁保留路由不刪（導覽列與頁尾的「聯絡我們」仍在用 `/about`，SEO 也需要），
 * 只留標題 + 定位宣言 + 一個連到 `/coaches#about` 的入口，避免與教練頁
 * 完全重複。原「累積數字」（首頁已有同一組）與「追蹤我們 IG」（頁尾已有
 * `@msw_street_workout`）兩塊屬重複資訊，已移除。
 *
 * 文案紀律：`pages.about.page_title` 與 `content.about.lead` 皆為既有文案、
 * 原樣沿用；本檔唯一新增的字串是連結按鈕「在教練團隊頁閱讀完整介紹」，
 * 純導覽用途。
 */
export default async function AboutPage() {
  const [pages, content] = await Promise.all([getSitePages(), getSiteContent()]);

  return (
    <section className="relative overflow-hidden border-b border-ink-line">
      <div className="grid-lines absolute inset-0" aria-hidden />
      <div className="noise-overlay" aria-hidden />
      {/* 單側光暈：沿用原 /about hero 的視覺語言 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-[16%] -top-[40%] h-[640px] w-[640px] rounded-full blur-[135px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--color-cobalt) 78%, transparent), transparent 66%)",
          opacity: 0.45,
        }}
      />

      <div className="container-msw relative z-10">
        <div className="pb-16 pt-28 md:pb-20 md:pt-36">
          <h1 className="mt-6">
            <span className="display-xl block text-white">
              {pages.about.page_title}
            </span>
            <span className="relative mt-1 block">
              <span
                aria-hidden
                className="display-xl text-outline text-outline-vital absolute left-[0.04em] top-[0.04em] block"
              >
                About
              </span>
              <span className="display-xl relative block text-vital-bright">
                About
              </span>
            </span>
          </h1>

          <p className="mt-10 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg">
            {content.about.lead}
          </p>

          <Link
            href="/coaches#about"
            className="btn-base btn-vital btn-slab mt-10"
          >
            在教練團隊頁閱讀完整介紹 <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
}
