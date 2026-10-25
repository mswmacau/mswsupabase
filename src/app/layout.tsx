import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SetupBanner } from "@/components/SetupBanner";
import { NavProgress } from "@/components/NavProgress";
import { PageViewBeacon } from "@/components/tracking/PageViewBeacon";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getSiteContact, getSiteNav, getSiteSeo, getSiteTheme } from "@/lib/queries";
import { DEFAULT_THEME, themeCssVars } from "@/lib/theme";
import { publicAssetUrl } from "@/lib/assets";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://msw-street-workout.vercel.app";

/** 分頁標題模板的站名後綴（品牌固定字，不屬於 site_seo 可編輯範圍） */
const TITLE_SUFFIX = "MSW 街健館";

/**
 * 全站 SEO metadata（T-12：靜態 metadata 改 generateMetadata 掛載 site_seo）。
 *
 * 紅線：getSiteSeo() 在 DB 無值時回落 DEFAULT_SEO（與本檔原靜態常數逐字一致，
 * 見 src/lib/seo.ts 檔頭紀律），因此未在後台改過 SEO 時，view-source 與基線
 * 完全相同；管理員在「網站內容 → SEO」儲存新值後，此處即時反映。
 *
 * 組裝方式（後台 SEO 分區的中文說明依此撰寫）：
 *  - 子頁面有自己的 title 時 → 「頁面標題 | MSW 街健館」；
 *  - 沒有自設 title 的頁面（如主頁）→ 直接顯示 seo.title；
 *  - og / twitter 卡片全站沿用 seo.title + seo.description + seo.og_image
 *    （子頁面只設 title、不設 openGraph，故社群貼文一律用本站主設定）。
 */
export async function generateMetadata(): Promise<Metadata> {
  const seo = await getSiteSeo();

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: seo.title,
      template: `%s | ${TITLE_SUFFIX}`,
    },
    description: seo.description,
    openGraph: {
      title: seo.title,
      description: seo.description,
      type: "website",
      locale: "zh_HK",
      url: "/",
      siteName: TITLE_SUFFIX,
      // 相對路徑由 metadataBase（NEXT_PUBLIC_SITE_URL）補全為絕對網址
      images: [
        {
          url: seo.og_image.url,
          width: seo.og_image.width,
          height: seo.og_image.height,
          alt: seo.og_image.alt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: seo.title,
      description: seo.description,
      images: [seo.og_image.url],
    },
  };
}

export const viewport: Viewport = {
  // meta theme-color 無法引用 CSS 變數，改由 theme.ts 的 DEFAULT_THEME.color_ink
  // 提供單一來源（值同為 #0F0F0F，視覺不變），避免此處再出現硬編碼 hex
  themeColor: DEFAULT_THEME.color_ink,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [profile, theme, nav, contact] = await Promise.all([
    getCurrentProfile(),
    getSiteTheme(),
    getSiteNav(),
    getSiteContact(),
  ]);
  const cssVars = themeCssVars(theme);

  return (
    <html
      lang="zh-Hant"
      className="h-full antialiased"
      style={cssVars as React.CSSProperties}
    >
      <body className="flex min-h-full flex-col bg-ink text-white">
        <a href="#main" className="skip-link">
          跳至主要內容
        </a>
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <SetupBanner />
        <Nav
          isLoggedIn={Boolean(profile)}
          isAdmin={profile?.role === "admin"}
          displayName={profile?.display_name ?? null}
          points={profile?.points ?? 0}
          logoUrl={publicAssetUrl(theme.logo_path)}
          brandName={theme.brand_name}
          brandNameEn={theme.brand_name_en}
          navLinks={nav.links}
        />
        <main id="main" tabIndex={-1} className="flex-1">
          {children}
        </main>
        <Footer
          isLoggedIn={Boolean(profile)}
          isAdmin={profile?.role === "admin"}
          brandName={theme.brand_name}
          brandNameEn={theme.brand_name_en}
          contact={contact}
          navLinks={nav.links}
        />
        {/* 頁面停留追蹤（T-22）：零 UI、零 CLS，只送出匿名 beacon，不出現在 DOM */}
        <PageViewBeacon isMember={Boolean(profile)} />
      </body>
    </html>
  );
}
