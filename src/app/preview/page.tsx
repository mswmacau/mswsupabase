/**
 * /preview — 草稿預覽頁（T-16 MVP；管理員限定）
 *
 * 所見即草稿態：本頁渲染首頁（src/app/page.tsx 的 HomePage），而首頁與
 * root layout 的六個站點內容 getter（getSiteContent / getSiteNav /
 * getSiteContact / getSitePages / getSiteBlocks / getSiteSeo）在
 * 「draft mode 已啟用 + 呼叫者是管理員」時回草稿袋的值
 * （機制見 src/lib/draft.ts），因此本頁看到的就是草稿效果。
 *
 * 進入方式：管理員在 /admin/content 按「預覽」→ 前端開新視窗打
 * GET /api/admin/site-draft/preview（enable draft mode）→ 302 到本頁。
 * 退出：本頁橫額的「退出預覽」→ GET /api/admin/site-draft/preview?exit=1。
 *
 * 邊界（MVP，如實記錄）：預覽覆蓋首頁所用到的分區（content / nav /
 * contact / blocks）與全站 SEO metadata（seo）；pages（九個內頁文案）
 * 草稿在本頁看不到效果——本頁只渲染首頁，發佈後才會在 /login 等頁生效。
 *
 * Owner：白客（後端機制）；橫額文案屬 T-16 前端部分，方砚可再美化。
 */

import Link from "next/link";
import { requireAdmin } from "@/lib/supabase/server";
import { getDraftOverride, type DraftSectionKey } from "@/lib/draft";
import HomePage from "../page";

/**
 * P1-1（T-28 驗收）：本頁呼叫 requireAdmin()（內部走 cookies()），若無此宣告，
 * build 時沒有 Supabase env 的形態下會被靜態化——管理員直接開 /preview
 * （書籤／貼連結，無 __prerender_bypass cookie）只拿到 build 時預渲染的
 * 「請登入」快照（功能靜默失效）；ISR 失效後更會 500（DYNAMIC_SERVER_USAGE）。
 * 與 /admin/audit-log、/events、首頁一致強制動態渲染，行為不再依賴 build 環境。
 */
export const dynamic = "force-dynamic";

const SECTION_LABEL: Record<DraftSectionKey, string> = {
  content: "首頁文案",
  nav: "導覽選單",
  contact: "頁尾聯絡",
  pages: "頁面文案",
  blocks: "首頁區塊",
  seo: "SEO",
};

export default async function PreviewPage() {
  const admin = await requireAdmin();

  if (!admin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-white">預覽模式</h1>
        <p className="mt-3 text-white/70">請以管理員帳號登入後再查看草稿預覽。</p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-full bg-white px-6 py-2 text-sm font-semibold text-ink"
        >
          前往登入
        </Link>
      </div>
    );
  }

  // 與首頁／layout 的六個 getter 共用同一次請求作用域讀取（React cache 去重）
  const draft = await getDraftOverride();
  const sections = draft
    ? (Object.keys(draft) as DraftSectionKey[]).map((k) => SECTION_LABEL[k])
    : [];

  return (
    <>
      <div className="sticky top-0 z-50 border-b-2 border-amber-500/60 bg-amber-950/95 backdrop-blur">
        <div className="container-msw flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-100">
              預覽模式——所見是草稿，還沒發佈
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-200/85">
              {sections.length > 0
                ? `下面顯示的是尚未發佈的草稿內容（${sections.join("、")}），訪客看到的仍是正式內容；部分內頁文案需發佈後查看。`
                : "目前沒有草稿，下面顯示的是正式內容；部分內頁文案需發佈後查看。"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/admin/content"
              className="text-xs font-semibold text-amber-200 underline underline-offset-2 transition hover:text-amber-100"
            >
              前往發佈
            </Link>
            <Link
              href="/api/admin/site-draft/preview?exit=1"
              className="btn-base btn-vital text-xs"
            >
              退出預覽
            </Link>
          </div>
        </div>
      </div>
      <HomePage />
    </>
  );
}
