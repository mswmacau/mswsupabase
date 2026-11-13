import { getAllSlides, isSlidesTableReady } from "@/lib/home-slides";
import { SlidesManager } from "./SlidesManager";

export const metadata = { title: "首頁輪播" };
export const dynamic = "force-dynamic";

/**
 * 後台「首頁輪播」頁（server component）。
 *
 * 這裡先用 getAllSlides() 取一次資料給首屏渲染（避免進頁面先看到空白）。
 * getAllSlides() 讀不到資料時只回空陣列（前台不能因功能沒啟用就整頁 500），
 * 所以「表還沒建」這件事用 isSlidesTableReady() 另外探一次，並在 server 端
 * 直接把提示渲染出來——這樣即使瀏覽器 JS 沒跑，管理員也看得到要跑哪支 SQL。
 * SlidesManager 掛載後仍會 GET /api/admin/slides 對帳，涵蓋其他錯誤（例如權限）。
 */
export default async function AdminSlidesPage() {
  const [slides, tableReady] = await Promise.all([
    getAllSlides(),
    isSlidesTableReady(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">首頁輪播</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/75">
          上傳首頁形象圖並調整顯示順序。輪播出現在首頁主視覺下方，
          停用或未到排程時間的圖片不會顯示給訪客。
        </p>
      </div>

      {/* 資料表未建立時，server 端就先把原因寫出來（不依賴瀏覽器 JS） */}
      {!tableReady && (
        <div
          role="alert"
          className="min-w-0 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-3 text-xs leading-relaxed text-amber-200"
        >
          <span className="block font-semibold">輪播功能尚未啟用</span>
          <span className="mt-1 block break-words">
            資料表 public.home_slides 還沒建立，請先執行
            supabase/migration-home-slides.sql（Supabase Dashboard → SQL Editor
            整段貼上），完成後重新整理本頁。
          </span>
        </div>
      )}

      <SlidesManager initialSlides={slides} />
    </div>
  );
}
