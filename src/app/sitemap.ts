import type { MetadataRoute } from "next";

/**
 * 前台公開頁面的 sitemap（2026-09-25 SEO 修復）。
 * /admin/*、/api/*、/dashboard/* 已在 robots.txt 排除，這裡只列公開路由。
 *
 * `/about` 已於「關於我們整併」下架，改成永久轉址到 `/coaches#about`，
 * 因此不列入 sitemap（轉址頁不是獨立內容頁，列了只會被搜尋引擎當重複內容）。
 * 真正的內容頁是 `/coaches`。
 */
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mswmacau.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    "",
    "/events",
    "/training",
    "/run",
    "/leaderboard",
    "/privacy",
    "/coaches",
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
