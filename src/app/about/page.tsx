import { permanentRedirect } from "next/navigation";

/**
 * 關於我們：內容已整併到教練團隊頁底部的「關於我們」區塊
 * （`src/app/coaches/page.tsx` 的 `BrandIntro`，自帶 `id="about"`）。
 *
 * 本路由只做永久轉址（308 → `/coaches#about`），刻意不用 `notFound()`：
 * 舊的宣傳連結、Google 已收錄的結果、會員書籤都會繼續可用，不會變成 404。
 * 轉址頁不列入 `src/app/sitemap.ts`，避免搜尋引擎把它當成獨立內容頁。
 */
export default function AboutPage() {
  permanentRedirect("/coaches#about");
}
