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

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "MSW 街健館 | Macau Street Workout",
    template: `%s | MSW 街健館`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    title: "MSW 街健館 | Macau Street Workout",
    description: SITE_DESCRIPTION,
    type: "website",
    locale: "zh_HK",
    url: "/",
    siteName: "MSW 街健館",
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
        <main className="flex-1">{children}</main>
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
