/**
 * src/lib/draft.ts — 草稿預覽的請求作用域覆蓋（T-16，MVP）
 *
 * Owner：白客（backend-engineer）；方硯（前端）只讀，不要修改本檔。
 * 契約：主理人範圍裁決（草稿袋 + 管理員預覽 + 三按鈕）；V1 計劃 C11 降級條款。
 *
 * 【機制選擇（兩條路的最終裁決，詳見交付回報）】
 * 採「React cache 請求作用域覆蓋」而非「草稿 vs 現行對照表」：
 *   - 閘門用 Next 內建 draft mode（next/headers 的 draftMode()，cookie 驅動），
 *     /api/admin/site-draft/preview 進入時 enable、?exit=1 離開時 disable；
 *   - 讀取用 React cache() 包裝的 getDraftOverride()，同一次請求內六個 getter
 *     共用一次 DB 讀取；
 *   - 覆蓋檢查放在六個 getter 的「外層」，unstable_cache 的內層函數一字未動——
 *     預覽請求永遠不會把草稿值寫進跨請求的資料快取（不會汙染前台）。
 *
 * 【前台零影響保證（紅線）】
 * 1) 未啟用 draft mode 時，isPreviewMode() 只讀 cookie、不打 DB，getDraftOverride()
 *    直接回 null，六個 getter 走與本檔上線前完全相同的 unstable_cache 路徑；
 * 2) 即使啟用 draft mode，呼叫者不是管理員 → 同樣回 null（前台不變）；
 * 3) 啟用且是管理員 → 只影響「這一次請求」的渲染結果（預覽頁本來就該看草稿），
 *    不寫任何跨請求快取、不寫 DB。
 */

import { cache } from "react";
import { draftMode } from "next/headers";
import { createClient, getCurrentProfile } from "./supabase/server";

/** 草稿袋在 app_settings 的鍵（播種見 supabase/migration-site-draft.sql） */
export const SITE_DRAFT_KEY = "site_content_draft";

/** 草稿袋的六個分區（與 api/admin/site-draft 的分區表一致） */
export type DraftSectionKey =
  | "content"
  | "nav"
  | "contact"
  | "pages"
  | "blocks"
  | "seo";

/** 草稿袋：只含實際儲存了的分區 */
export type DraftBag = Partial<Record<DraftSectionKey, unknown>>;

/**
 * 本次請求是否處於草稿預覽模式。
 *
 * cache() 包裝 = 同一次請求只判斷一次。draftMode() 讀的是 Next 的
 * preview cookie：未啟用時零 DB 開銷；讀取 isEnabled 不會把路由標成動態
 * （只有 enable/disable 才會），因此不影響任何頁面的渲染行為。
 * 非請求上下文（理論上不會發生）→ 當作非預覽，保守處理。
 */
export const isPreviewMode = cache(async (): Promise<boolean> => {
  try {
    return (await draftMode()).isEnabled;
  } catch {
    return false;
  }
});

/**
 * 從草稿袋取出某個分區；不是「非空物件」就當作沒有這個分區。
 * （袋內值在儲存前都過過 normalize*，正常情況一定是完整物件；這裡是防髒值。）
 */
export function draftSection(
  bag: DraftBag | null,
  key: DraftSectionKey
): unknown {
  const v = bag?.[key];
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  return v;
}

/**
 * 本次請求的草稿覆蓋袋（T-16 核心）。
 *
 * - 非預覽模式 → null（零 DB 開銷；前台路徑行為與上線前逐字一致）；
 * - 預覽模式但呼叫者不是管理員 → null（draft cookie 在 dev 可被偽造，
 *   這裡加一道閘門，未發佈內容不會出現在一般訪客或會員眼前）；
 * - 預覽模式且是管理員 → 讀 site_content_draft；空袋 {} = 無草稿 → null。
 *
 * cache() 包裝 = 同一次請求內六個 getter 共用同一次讀取。
 */
export const getDraftOverride = cache(async (): Promise<DraftBag | null> => {
  if (!(await isPreviewMode())) return null;

  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return null;

  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", SITE_DRAFT_KEY)
    .maybeSingle();
  if (error || !data) return null;

  const bag = data.value;
  if (typeof bag !== "object" || bag === null || Array.isArray(bag)) return null;
  if (Object.keys(bag as Record<string, unknown>).length === 0) return null;

  return bag as DraftBag;
});
