/**
 * src/lib/seo.ts — SEO metadata（site_seo）型別、預設值與驗證
 *
 * Owner：白客（backend-engineer）
 * 方硯（前端）只讀：import 型別 / DEFAULT_SEO / normalizeSeo / coerceSeo，
 * 不要修改本檔。layout.tsx 的 generateMetadata 掛載由方硯負責（T-12 前端部分），
 * 本檔只提供資料層與後台 API 用的驗證。
 *
 * 契約來源：《MSW 管理後台系統補強 — 分析與實施計劃 V2》
 *  - §7.1 app_settings 鍵總表（site_seo，T-12）
 *  - §8.1 管理端路由契約（/api/admin/site-seo 的 GET/POST/DELETE）
 *  - §3.1 F11（SEO：標題／描述／OG 圖，純文字／字數上限）
 *
 * ⚠️ 預設值紀律（T-12 驗收點）：
 *  DEFAULT_SEO 為 src/app/layout.tsx 現行 metadata 常數的「逐字轉錄」
 *  （SITE_DESCRIPTION / OG_TITLE / OG_IMAGE，layout.tsx 第 13–25 行），
 *  一個字都不能改——未接線前前台與基線一致，接線後 DB 無值時也回落同一份。
 *  本檔與 supabase/migration-site-seo.sql 的播種值必須逐字一致
 *  （交付說明附一致性比對腳本輸出）。
 *
 * 驗證邏輯紀律（复刻 content.ts）：
 *  - 寫入端用 normalizeSeo()：超長／型別錯／格式錯 → { ok:false, fields }，
 *    由 Route Handler 組成 400 中文錯誤，DB 不寫；缺鍵／留空 → 落預設值。
 *  - 讀取端用 coerceSeo()：DB 裡的值可能被手改過，一律 best-effort 回落
 *    預設值，任何情況下都不拋例外。
 */

/* =============================================================
 * 型別（從 layout.tsx 現值推：OG 圖為相對路徑 + 寬高 + alt）
 * ============================================================= */

/** OG 圖片（Open Graph / Twitter Card 共用） */
export interface SiteSeoOgImage {
  /** 相對路徑（/og-image.png）或 https:// 完整網址 */
  url: string;
  width: number;
  height: number;
  alt: string;
}

/** site_seo：全站 SEO metadata（標題／描述／OG 圖） */
export interface SiteSeo {
  title: string;
  description: string;
  og_image: SiteSeoOgImage;
}

/* =============================================================
 * 預設值（逐字轉錄 src/app/layout.tsx 第 13–25 行）
 * ============================================================= */

export const DEFAULT_SEO: SiteSeo = {
  title: "MSW 街健館 | Macau Street Workout",
  description:
    "MSW 街健館是澳門街頭健身社群平台。每週定期訓練、每月 300 公里跑步挑戰、積分與優惠券獎勵，讓訓練變成看得見的累積。",
  og_image: {
    url: "/og-image.png",
    width: 1200,
    height: 630,
    alt: "MSW 街健館 — 用自身的重量，練出澳門最強的街頭力量",
  },
};

/* =============================================================
 * 護欄參數
 * ============================================================= */

const SEO_TITLE_MAXLEN = 60; // 搜尋結果標題實務上限（現值 26 字，寬裕）
const SEO_DESC_MAXLEN = 200; // meta description 實務上限（現值約 66 字，寬裕）
const SEO_OG_URL_MAXLEN = 300;
const SEO_OG_ALT_MAXLEN = 120;
const SEO_OG_DIM_MIN = 1;
const SEO_OG_DIM_MAX = 10_000;

/** OG 圖路徑：站內相對路徑（/ 開頭）或 http(s) 絕對網址 */
const OG_URL_RE = /^(?:\/[A-Za-z0-9/_.-]*|https?:\/\/\S+)$/;

/* =============================================================
 * 驗證共用工具（與 content.ts 同款紀律；此處自持以免耦合其私有區塊）
 * ============================================================= */

type FieldErrors = Record<string, string>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 文字欄位：
 *  - 缺鍵 / null → 落 base（預設值），不算錯
 *  - 空字串（留空）→ 落 base（計劃 §6.1 F5「留空回落預設」）
 *  - 非字串 → 欄位錯誤 + 落 base
 *  - 超過 maxLen → 欄位錯誤 + 落 base
 *  - 其餘 → 去前後空白後採用
 */
function textValue(
  raw: unknown,
  base: string,
  key: string,
  maxLen: number,
  fields: FieldErrors
): string {
  if (raw === undefined || raw === null) return base;
  if (typeof raw !== "string") {
    fields[key] = "內容格式錯誤，請輸入文字。";
    return base;
  }
  const trimmed = raw.trim();
  if (trimmed === "") return base;
  if (trimmed.length > maxLen) {
    fields[key] = `請填 ${maxLen} 字以內。`;
    return base;
  }
  return trimmed;
}

/** 整數欄位：缺鍵落 base；非整數或超出 [min, max] → 欄位錯誤 + 落 base */
function intValue(
  raw: unknown,
  base: number,
  key: string,
  min: number,
  max: number,
  fields: FieldErrors
): number {
  if (raw === undefined || raw === null) return base;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;
  if (!Number.isInteger(n) || n < min || n > max) {
    fields[key] = `請填 ${min}–${max} 的整數。`;
    return base;
  }
  return n;
}

/* =============================================================
 * normalize / coerce
 * ============================================================= */

function normalizeSeoInternal(
  input: unknown,
  base: SiteSeo
): { seo: SiteSeo; fields: FieldErrors } {
  // 非物件（理論上不會發生——Route Handler 的 readJson 已擋）→ 視為空物件，全部落預設
  const src: Record<string, unknown> = isRecord(input) ? input : {};
  const fields: FieldErrors = {};

  const title = textValue(src.title, base.title, "title", SEO_TITLE_MAXLEN, fields);
  const description = textValue(
    src.description,
    base.description,
    "description",
    SEO_DESC_MAXLEN,
    fields
  );

  // og_image：整組缺鍵／null → 落預設；非物件 → 欄位錯誤 + 落預設
  const og: SiteSeoOgImage = { ...base.og_image };
  const rawOg = src.og_image;
  if (rawOg !== undefined && rawOg !== null) {
    if (!isRecord(rawOg)) {
      fields.og_image = "OG 圖片資料格式錯誤。";
    } else {
      let url = textValue(rawOg.url, base.og_image.url, "og_image.url", SEO_OG_URL_MAXLEN, fields);
      if (typeof rawOg.url === "string" && rawOg.url.trim() !== "" && !OG_URL_RE.test(url)) {
        fields["og_image.url"] = "請填以 / 開頭的相對路徑，或 https:// 開頭的完整網址。";
        url = base.og_image.url;
      }
      og.url = url;
      og.width = intValue(
        rawOg.width,
        base.og_image.width,
        "og_image.width",
        SEO_OG_DIM_MIN,
        SEO_OG_DIM_MAX,
        fields
      );
      og.height = intValue(
        rawOg.height,
        base.og_image.height,
        "og_image.height",
        SEO_OG_DIM_MIN,
        SEO_OG_DIM_MAX,
        fields
      );
      og.alt = textValue(rawOg.alt, base.og_image.alt, "og_image.alt", SEO_OG_ALT_MAXLEN, fields);
    }
  }

  return { seo: { title, description, og_image: og }, fields };
}

export type SeoNormalizeResult =
  | { ok: true; seo: SiteSeo }
  | { ok: false; fields: FieldErrors };

/** 寫入端：任一欄位不合法 → { ok:false, fields }（Route Handler 轉 400，DB 不寫） */
export function normalizeSeo(
  input: unknown,
  base: SiteSeo = DEFAULT_SEO
): SeoNormalizeResult {
  const { seo, fields } = normalizeSeoInternal(input, base);
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, seo };
}

/** 讀取端：DB 髒值 best-effort 回落預設，永不拋錯 */
export function coerceSeo(input: unknown, base: SiteSeo = DEFAULT_SEO): SiteSeo {
  return normalizeSeoInternal(input, base).seo;
}
