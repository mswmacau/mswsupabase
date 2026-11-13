/**
 * src/lib/home-slides.ts — 首頁圖片輪播的資料讀取（前台公開 + 後台全量）
 *
 * 資料表：supabase/migration-home-slides.sql 的 public.home_slides。
 * 型別刻意寫在本檔，不動 src/lib/types.ts（該檔由其他人維護）。
 *
 * 兩個 getter 的分工：
 *   · getActiveSlides()：前台用。anonClient + unstable_cache（60 秒、tag `home-slides`）。
 *     匿名客戶端不含 cookie，才不會把首頁變成動態渲染；篩選「啟用中＋在排程期間內」
 *     的條件寫在 RLS 政策裡（見 migration §4），資料庫就是唯一事實來源，
 *     這裡不再用 JS 過濾時間（避免時區與快取造成前後端不一致）。
 *   · getAllSlides()：後台用。不快取、用帶 cookie 的 server client，
 *     這樣 RLS 的 home_slides_admin_all 政策才會讓管理員看到停用中／已排程下架的列。
 *
 * 【為什麼 getActiveSlides 內層再包 cache()】
 * 與 src/lib/queries.ts 的 getSiteTheme() 同一套模式：同一請求內若多處呼叫，
 * React.cache 只打一次 DB；跨請求則由 unstable_cache 以 tag 管理。
 * 寫入端（api/admin/slides）用 revalidateTag(HOME_SLIDES_TAG) 失效。
 *
 * 【表還沒建時的取捨（重要）】
 * 客戶要先跑 migration，我們沒有 DB 權限無法代跑。表不存在時 PostgREST 會回
 * 42P01 / PGRST205，這裡一律吞掉回空陣列——首頁不能因為「輪播功能還沒啟用」
 * 就整頁 500。真正的「請先跑 SQL」提示放在後台（API 回 SCHEMA_OUTDATED），
 * 因為那才是會去跑 SQL 的人看到的畫面。
 */

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { anonClient } from "./supabase/anon";
import { createClient } from "./supabase/server";

/** 一筆首頁輪播圖。欄位與 public.home_slides 一一對應。 */
export interface HomeSlide {
  id: string;
  /** site-assets bucket 內的路徑，形如 home/1730000000000-ab12cd.jpg */
  path: string;
  /** 替代文字（無障礙必填，1–120 字） */
  alt: string;
  /** 點整張圖要去的站內路徑（只會是單一 / 開頭），可為 null */
  link_url: string | null;
  sort_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
}

/** getActiveSlides() 的 cache tag；revalidateTag 必須用同一個字串（see api/admin/slides） */
export const HOME_SLIDES_TAG = "home-slides";

/** 硬上限，與 migration-home-slides.sql 的 trigger 一致 */
export const HOME_SLIDES_MAX = 30;

/** 明確列出欄位，不用 select("*")——日後加欄位不會把資料量悄悄放大 */
const SLIDE_COLUMNS =
  "id,path,alt,link_url,sort_order,is_active,starts_at,ends_at";

/** DB 列 → HomeSlide（補上型別與 null 正規化；結構穩定，缺欄位也不會炸） */
function toSlide(row: Record<string, unknown>): HomeSlide {
  return {
    id: String(row.id ?? ""),
    path: String(row.path ?? ""),
    alt: String(row.alt ?? ""),
    link_url: typeof row.link_url === "string" && row.link_url ? row.link_url : null,
    sort_order: Number(row.sort_order ?? 0),
    is_active: row.is_active !== false,
    starts_at: typeof row.starts_at === "string" ? row.starts_at : null,
    ends_at: typeof row.ends_at === "string" ? row.ends_at : null,
  };
}

/** 公開讀取：只回「啟用中且在排程期間內」的輪播圖，依 sort_order 升冪。 */
export const getActiveSlides = unstable_cache(
  cache(async (): Promise<HomeSlide[]> => {
    const supabase = anonClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from("home_slides")
      .select(SLIDE_COLUMNS)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(HOME_SLIDES_MAX);

    // 表還沒建（42P01 / PGRST205）或任何讀取錯誤 → 回空陣列，首頁照常渲染
    if (error || !data) return [];

    return (data as Record<string, unknown>[]).map(toSlide);
  }),
  ["home-slides"],
  { tags: [HOME_SLIDES_TAG], revalidate: 60 }
);

/**
 * 探測 home_slides 是否已建立（給後台頁用）。
 *
 * 【為什麼需要這個】getAllSlides() 讀不到資料時一律回空陣列（前台不能因為
 * 功能沒啟用就整頁 500）。但後台如果不說原因，管理員只會看到「0 張」，
 * 不知道要先去跑 migration。這個函式讓後台頁能在 **server 端**就把提示渲染出來，
 * 不依賴瀏覽器 JS（本機 dev 環境的 client JS 未 hydration 時照樣看得到）。
 *
 * 注意：不能用 `head: true` 的 count 查詢探測——實測 PostgREST 對不存在的表
 * 回 count=0 且不帶 error，探不出來。這裡用一次真正的 select。
 */
export async function isSlidesTableReady(): Promise<boolean> {
  const supabase = await createClient();
  if (!supabase) return false;

  const { error } = await supabase.from("home_slides").select("id").limit(1);
  if (error) {
    console.warn("[home-slides] 資料表尚未就緒：", error.message);
    return false;
  }
  return true;
}

/**
 * 後台讀取：全部（含停用），不快取。
 * 用帶 cookie 的 server client，才吃得到 is_admin() 那條 RLS 政策。
 */
export async function getAllSlides(): Promise<HomeSlide[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("home_slides")
    .select(SLIDE_COLUMNS)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(HOME_SLIDES_MAX);

  if (error || !data) {
    // 沒權限／表不存在都在這裡吞掉；後台 UI 另有 GET 對帳會顯示真正原因
    if (error) console.warn("[home-slides] getAllSlides 讀取失敗：", error.message);
    return [];
  }

  return (data as Record<string, unknown>[]).map(toSlide);
}
