import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SetupBanner } from "@/components/SetupBanner";
import { NavProgress } from "@/components/NavProgress";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getSiteTheme } from "@/lib/queries";
import { themeCssVars } from "@/lib/theme";
import { publicAssetUrl } from "@/lib/assets";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://msw-street-workout.vercel.app";

const SITE_DESCRIPTION =
  "MSW 街健館是澳門街頭健身社群平台。每週定期訓練、每月 300 公里跑步挑戰、積分與優惠券獎勵，讓訓練變成看得見的累積。";

const OG_TITLE = "MSW 街健館 | Macau Street Workout";
const OG_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "MSW 街健館 — 用自身的重量，練出澳門最強的街頭力量",
} as const;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: OG_TITLE,
    template: `%s | MSW 街健館`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    title: OG_TITLE,
    description: SITE_DESCRIPTION,
    type: "website",
    locale: "zh_HK",
    url: "/",
    siteName: "MSW 街健館",
    // 相對路徑由 metadataBase（NEXT_PUBLIC_SITE_URL）補全為絕對網址
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE.url],
  },
};

export const viewport: Viewport = {
  themeColor: "#0F0F0F",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  const theme = await getSiteTheme();
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
        />
        <main id="main" tabIndex={-1} className="flex-1">
          {children}
        </main>
        <Footer
          isLoggedIn={Boolean(profile)}
          isAdmin={profile?.role === "admin"}
          brandName={theme.brand_name}
          brandNameEn={theme.brand_name_en}
        />
      </body>
    </html>
  );
}
