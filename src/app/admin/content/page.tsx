import {
  getSiteBlocks,
  getSiteContact,
  getSiteContent,
  getSiteNav,
  getSitePages,
  getSiteSeo,
} from "@/lib/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { ContentManager } from "./ContentManager";

export const metadata = { title: "網站內容" };
export const dynamic = "force-dynamic";

/**
 * 網站內容管理（T-7）：六分區對應 app_settings 六鍵
 * ① 首頁文案（site_content）② 導覽選單（site_nav）③ 頁尾聯絡（site_contact）
 * ④ 各頁文案（site_pages）⑤ 首頁區塊（site_blocks）⑥ SEO（site_seo，T-12 實作）
 *
 * 資料來源與前台同一套 getSite*()：DB 無值 → 回落 DEFAULT_*（= 原廠預設），
 * 所以在這裡看到的值就是訪客此刻看到的值。
 */
export default async function AdminContentPage() {
  const [content, nav, contact, pages, blocks, seo] = await Promise.all([
    getSiteContent(),
    getSiteNav(),
    getSiteContact(),
    getSitePages(),
    getSiteBlocks(),
    getSiteSeo(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">網站內容</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/75">
          管理首頁文案、導覽選單、頁尾聯絡資訊、各頁面文案、首頁區塊排序與全站
          SEO 設定。所有修改會即時套用至前台，訪客最遲 60 秒後看到；也可隨時「回復原廠」。
        </p>
      </div>

      {!isSupabaseConfigured && (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        >
          尚未連接 Supabase，以下顯示的是原廠預設值，儲存與回復功能暫時不可用。
        </div>
      )}

      <ContentManager
        content={content}
        nav={nav}
        contact={contact}
        pages={pages}
        blocks={blocks}
        seo={seo}
        supabaseReady={isSupabaseConfigured}
      />
    </div>
  );
}
