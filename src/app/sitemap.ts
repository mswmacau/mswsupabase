import type { MetadataRoute } from "next";

/**
 * 前台公開頁面的 sitemap（2026-09-25 SEO 修復）。
 * /admin/*、/api/*、/dashboard/* 已在 robots.txt 排除，這裡只列公開路由。
 */
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://msw-street-workout.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    "",
    "/events",
    "/training",
    "/run",
    "/leaderboard",
    "/signup",
    "/login",
  ];

  return routes.map((route) => ({
    url: `${SITE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.7,
  }));
}
