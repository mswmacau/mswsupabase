import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient } from "./supabase/server";
import { anonClient } from "./supabase/anon";
import { coerceTheme, DEFAULT_THEME, type SiteTheme } from "./theme";
import { coerceSeo, DEFAULT_SEO, type SiteSeo } from "./seo";
import {
  DEFAULT_BLOCKS,
  DEFAULT_CONTACT,
  DEFAULT_CONTENT,
  DEFAULT_NAV,
  DEFAULT_PAGES,
  coerceBlocks,
  coerceContact,
  coerceContent,
  coerceNav,
  coercePages,
  type SiteBlocks,
  type SiteContact,
  type SiteContent,
  type SiteNav,
  type SitePages,
} from "./content";
import {
  draftSection,
  getDraftOverride,
  type DraftSectionKey,
} from "./draft";
import { currentMonth, monthLabel, todayISO } from "./utils";
import { isUuid } from "./api";
import type {
  Coupon,
  Event,
  EventPhoto,
  HyroxEvent,
  HyroxPastEvent,
  HyroxRegistration,
  LeaderRow,
  MonthlyStat,
  PointTransaction,
  Profile,
  RunSubmission,
  ScheduleLegendItem,
  SiteStats,
  TrainingCategory,
  TrainingCheckin,
  TrainingClass,
  TrainingMonth,
  TrainingSession,
  TrainingSessionRow,
} from "./types";

const EMPTY_STATS: SiteStats = {
  members: 0,
  total_km: 0,
  total_runs: 0,
  total_sessions: 0,
};

/** 全站統計（首頁數字） */
export async function getSiteStats(): Promise<SiteStats> {
  const supabase = await createClient();
  if (!supabase) return EMPTY_STATS;

  const { data, error } = await supabase.from("site_stats").select("*").maybeSingle();
  if (error || !data) return EMPTY_STATS;

  return {
    members: Number(data.members ?? 0),
    total_km: Number(data.total_km ?? 0),
    total_runs: Number(data.total_runs ?? 0),
    total_sessions: Number(data.total_sessions ?? 0),
  };
}

/** 即將到來的訓練場次 */
export async function getUpcomingSessions(limit = 4): Promise<TrainingSession[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("training_sessions")
    .select("*")
    .gte("session_date", today)
    .order("session_date", { ascending: true })
    .limit(limit);

  return (data as TrainingSession[]) ?? [];
}

/** 全部訓練場次（含歷史） */
export async function getAllSessions(limit = 60): Promise<TrainingSession[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("training_sessions")
    .select("*")
    .order("session_date", { ascending: false })
    .limit(limit);

  return (data as TrainingSession[]) ?? [];
}

/* ── 定期訓練班表（月曆）────────────────────────────────────────────────
 * 資料來源：supabase/migration-training-schedule.sql
 *   training_classes（課程）｜training_rules（週期規則）｜training_sessions（場次）
 *
 * 時區一律 Asia/Macau：DB 內 session_date 是 date、start_time 是 time，
 * 兩者都是「澳門本地牆上時間」的語意（生成器用 at time zone 'Asia/Macau' 產生
 * starts_at/ends_at），因此前台只要直接組合字串即可，不必再做時區換算，
 * 也不會因為伺服器在 UTC 而位移一天。
 *
 * 快取：anonClient（不含 cookie，避免整頁被迫轉動態）+ unstable_cache
 *       （tag `training-schedule`、60 秒）。寫入端（api/admin/training/*）以
 *       revalidateTag(TRAINING_SCHEDULE_TAG) 立即失效。
 *       註：unstable_cache 的 cache key 由 keyParts + 序列化後的參數組成
 *       （next/dist/server/web/spec-extension/unstable-cache.js 的 invocationKey），
 *       所以不同 year/month 不會共用同一筆快取。
 * ──────────────────────────────────────────────────────────────────── */

/** 班表快取 tag；revalidateTag 必須用同一個字串 */
export const TRAINING_SCHEDULE_TAG = "training-schedule";

/**
 * 該月第一天與最後一天（YYYY-MM-DD）。
 * 參數非法回 null（呼叫端自行決定 fallback），不拋錯——
 * 避免後台亂傳 year=0 / month=13 時讓整個頁面 500。
 */
export function trainingMonthRange(
  year: number,
  month: number
): { from: string; to: string } | null {
  if (!Number.isInteger(year) || year < 2024 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  const mm = String(month).padStart(2, "0");
  // Date.UTC(year, month, 0) = 該月最後一天（month 為 1-based，故傳 month 剛好是下月 0 日）
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** 月曆查詢的欄位（課程以別名 class 內嵌，回傳後攤平） */
const MONTH_SELECT =
  "id, session_date, start_time, end_time, class_id, title, location, location_override, coach_name, capacity, status, note, class:training_classes(name, color_key, category)";

type MonthRow = {
  id: string;
  session_date: string;
  start_time: string | null;
  end_time: string | null;
  class_id: string | null;
  title: string;
  location: string;
  location_override: string | null;
  coach_name: string | null;
  capacity: number;
  status: "open" | "closed" | "cancelled";
  note: string | null;
  class: {
    name: string | null;
    color_key: string | null;
    category: TrainingCategory | null;
  } | null;
};

/**
 * 某年某月的所有訓練場次（含課程名稱、顏色、教練、場地、狀態），
 * 依 session_date、start_time 升冪排序。
 *
 * 同日同時段可以有多堂（不同課程／場地／教練），所以排序第二鍵是 start_time，
 * 第三鍵用 id 保證順序穩定（同一時間多堂時不會每次呼叫都換位置）。
 */
export const getMonthSchedule = unstable_cache(
  cache(async (year: number, month: number): Promise<TrainingSessionRow[]> => {
    const range = trainingMonthRange(year, month);
    if (!range) return [];

    const supabase = anonClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from("training_sessions")
      .select(MONTH_SELECT)
      .gte("session_date", range.from)
      .lte("session_date", range.to)
      .order("session_date", { ascending: true })
      .order("start_time", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true });

    if (error || !data) return [];

    return (data as unknown as MonthRow[]).map((row) => ({
      id: row.id,
      session_date: row.session_date,
      start_time: row.start_time,
      end_time: row.end_time,
      class_id: row.class_id,
      title: row.title,
      location: row.location,
      location_override: row.location_override,
      coach_name: row.coach_name,
      capacity: row.capacity,
      status: row.status,
      note: row.note,
      class_name: row.class?.name ?? null,
      class_color_key: row.class?.color_key ?? null,
      class_category: row.class?.category ?? null,
    }));
  }),
  ["training-schedule-month"],
  { tags: [TRAINING_SCHEDULE_TAG], revalidate: 60 }
);

/** 啟用中的課程（前台日曆的圖例／篩選用） */
export const getTrainingClasses = unstable_cache(
  cache(async (): Promise<TrainingClass[]> => {
    const supabase = anonClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from("training_classes")
      .select(
        "id, slug, name, category, color_key, duration_min, capacity, coach_name, location, description, is_active, sort_order, created_at"
      )
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error || !data) return [];
    return data as TrainingClass[];
  }),
  ["training-classes-active"],
  { tags: [TRAINING_SCHEDULE_TAG], revalidate: 60 }
);

/* ── 月份發布與自動上架（migration-training-months.sql）──────────────────
 * 客戶語義：「到 12 月 1 日自動上架 12 月、同步下架 11 月」。
 * 沒有 cron：可見性由 DB 的 is_month_visible() 在「讀取時」比較 now()，
 * 前台再自己比一次 publish_at 當第二道保險。
 *
 * 為什麼用 anonClient：RLS 的 sessions_select_visible 已經擋掉
 * 未發布／未到時間的月份，這裡直接吃 RLS 的結果，不必在應用層重寫一次規則。
 *
 * 快取時效：unstable_cache 60 秒 TTL 意味著「每月 1 日 00:00 到點」與
 * 「後台按發布」最多延遲 60 秒生效（後台發布會 revalidateTag 立即失效，
 * 時間到點那一瞬間靠 TTL 自然過期）。刻意不改成 force-dynamic：
 * 為了一個月一次的 60 秒誤差放棄整頁快取不划算。
 * ──────────────────────────────────────────────────────────────────── */

/** training_months 的讀取列 */
type MonthPublishRow = {
  year: number;
  month: number;
  status: "draft" | "published";
  publish_at: string | null;
};

/**
 * 該月生效時間的預設值：該月 1 日 00:00（Asia/Macau）。
 * 與 SQL 的 `(make_date(year, month, 1)::timestamp at time zone 'Asia/Macau')` 等效。
 *
 * 註：同名邏輯在 api/admin/training/_shared.ts 也有一份（monthStartISO）。
 * 刻意不從 queries.ts 反向 import `src/app/**`：那會把 Route Handler 拉進
 * client bundle 的模組圖。三行重複比錯誤的依賴方向划算。
 */
function monthStartMacauISO(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01T00:00:00+08:00`;
}

/** 生效時間是否已到（解析失敗視為未到，寧可少顯示也不要提前洩漏） */
function isEffective(row: MonthPublishRow): boolean {
  const at = row.publish_at ?? monthStartMacauISO(row.year, row.month);
  const ts = new Date(at).getTime();
  return Number.isFinite(ts) && ts <= Date.now();
}

/**
 * 已發布且已到生效時間的月份清單（前台月份切換器用）。
 * 依年月升冪 —— 前台可直接把最後一個當「當月」。
 */
export const getAvailableMonths = unstable_cache(
  cache(async (): Promise<TrainingMonth[]> => {
    const supabase = anonClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from("training_months")
      .select("year, month, status, publish_at")
      .eq("status", "published")
      .order("year", { ascending: true })
      .order("month", { ascending: true });

    if (error || !data) return [];

    return (data as MonthPublishRow[])
      .filter(isEffective)
      .map((row) => ({
        year: row.year,
        month: row.month,
        status: row.status,
        publish_at: row.publish_at,
      }));
  }),
  ["training-months-available"],
  { tags: [TRAINING_SCHEDULE_TAG], revalidate: 60 }
);

/**
 * 某年某月的班表（含 cancelled 場次，供前台標示「這堂取消」）＋該月發布狀態。
 *
 * 回 null 的三種情況（前台據此顯示「本月班表尚未公布」）：
 *   1. 參數非法，或該月沒有 training_months 列（從未建立）
 *   2. 該月不是 published（RLS 也會讓 anon 讀不到這一列，這裡是第二道保險）
 *   3. 已發布但生效時間還沒到（客戶預先發布未來月份的情況）
 */
export const getScheduleMonth = unstable_cache(
  cache(
    async (
      year: number,
      month: number
    ): Promise<{ month: TrainingMonth; sessions: TrainingSessionRow[] } | null> => {
      const range = trainingMonthRange(year, month);
      if (!range) return null;

      const supabase = anonClient();
      if (!supabase) return null;

      const { data: monthData, error: monthError } = await supabase
        .from("training_months")
        .select("year, month, status, publish_at")
        .eq("year", year)
        .eq("month", month)
        .maybeSingle();

      if (monthError || !monthData) return null;

      const pub = monthData as MonthPublishRow;
      if (pub.status !== "published" || !isEffective(pub)) return null;

      const { data, error } = await supabase
        .from("training_sessions")
        .select(MONTH_SELECT)
        .gte("session_date", range.from)
        .lte("session_date", range.to)
        .order("session_date", { ascending: true })
        .order("start_time", { ascending: true, nullsFirst: true })
        .order("id", { ascending: true });

      if (error || !data) return null;

      const sessions: TrainingSessionRow[] = (data as unknown as MonthRow[]).map((row) => ({
        id: row.id,
        session_date: row.session_date,
        start_time: row.start_time,
        end_time: row.end_time,
        class_id: row.class_id,
        title: row.title,
        location: row.location,
        location_override: row.location_override,
        coach_name: row.coach_name,
        capacity: row.capacity,
        status: row.status,
        note: row.note,
        class_name: row.class?.name ?? null,
        class_color_key: row.class?.color_key ?? null,
        class_category: row.class?.category ?? null,
      }));

      return {
        month: {
          year,
          month,
          status: "published",
          publish_at: pub.publish_at,
          sessions_count: sessions.length,
        },
        sessions,
      };
    }
  ),
  ["training-schedule-published-month"],
  { tags: [TRAINING_SCHEDULE_TAG], revalidate: 60 }
);

/**
 * 前台日曆的色彩圖例（只回啟用中的，已依 sort_order 排序）。
 *
 * 客戶原話：「如果看不到，上方可以說明顏色所代表的活動，並且後台同步」
 * 手機日曆格子放不下課名，改用顏色短條，這份資料就是「顏色 → 活動」的解釋。
 *
 * 讀不到（migration 未執行 / Supabase 未設定 / 網路錯誤）一律回空陣列，
 * **不 throw** —— 前台的反應是「整段圖例不顯示」，日曆照常可用，
 * 不能因為少一張圖例表就讓 /events 掛掉。
 */
export const getScheduleLegend = unstable_cache(
  cache(async (): Promise<ScheduleLegendItem[]> => {
    const supabase = anonClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from("schedule_legend")
      .select("color_key, label, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("color_key", { ascending: true });

    if (error || !data) return [];

    return (data as ScheduleLegendItem[]).map((row) => ({
      color_key: row.color_key,
      label: row.label,
      sort_order: row.sort_order,
    }));
  }),
  ["schedule-legend"],
  { tags: [TRAINING_SCHEDULE_TAG], revalidate: 60 }
);

/** getSiteTheme() 的 cache tag；revalidateTag 必須用同一個字串（see api/admin/site-settings） */
export const SITE_THEME_TAG = "site-theme";
/* ── 站點內容五鍵（T-3；播種見 supabase/migration-site-content.sql）──
 * 管理端路由 api/admin/site-* 寫入後以 revalidateTag 失效同名快取；
 * 前台讀取（getSiteContent 等）由方硯接線時補，此處只放 tag 常數，
 * 兩邊必須用同一個字串，否則改了後台前台不會更新。 */
export const SITE_CONTENT_TAG = "site-content";
export const SITE_NAV_TAG = "site-nav";
export const SITE_CONTACT_TAG = "site-contact";
export const SITE_PAGES_TAG = "site-pages";
export const SITE_BLOCKS_TAG = "site-blocks";
export const SITE_SEO_TAG = "site-seo";

/**
 * 網站主題（单次 columns read）
 *
 * Q2：用不含 cookie 的匿名客戶端 + unstable_cache（60 秒、tag `site-theme`），
 *     讓 root layout 與後台設定頁在同一請求內只打一次 DB。
 *     註：依 SPEC §8.2 R1 的事前決策，若 unstable_cache 在 Next 16.3 行為異常
 *     則退回 React.cache()（只做同請求去重），不得自創其他快取機制。
 */
export const getSiteTheme = unstable_cache(
  cache(async (): Promise<SiteTheme> => {
    const supabase = anonClient();
    if (!supabase) return DEFAULT_THEME;

    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "site_theme")
      .maybeSingle();

    if (error || !data) return DEFAULT_THEME;

    return coerceTheme(data.value);
  }),
  ["site-theme"],
  { tags: [SITE_THEME_TAG], revalidate: 60 }
);

/* ── 站點內容五鍵的前台讀取（T-4/T-5/T-6/T-19/T-20 接線）─────────────
 * 模式完全复刻 getSiteTheme：不含 cookie 的 anonClient + unstable_cache
 * （60 秒 + 同名 tag），DB 無值／無 Supabase → 回落 DEFAULT_*——
 * DEFAULT_* 逐字等於原有硬編碼，所以沙箱（無 Supabase）渲染與基線一致。
 * 寫入端（api/admin/site-*）以 revalidateTag 失效同名字快取。 */

/* ── T-16 草稿預覽：請求作用域覆蓋（機制詳見 src/lib/draft.ts）───────
 * 六個站點內容 getter 一律改為「外層包裝 + 內層原路徑」兩層：
 *   - 外層 withDraftOverride()：預覽模式（管理員 + Next draft mode）時回
 *     草稿袋對應分區的值（coerce 後）；
 *   - 內層 *Cached：原 unstable_cache 函數一字未動，非預覽請求走的
 *     就是這條路——與 T-16 上線前的行為逐字一致。
 * 覆蓋檢查在 unstable_cache 之外，預覽請求不會把草稿值寫進跨請求快取。 */
async function withDraftOverride<T>(
  key: DraftSectionKey,
  coerce: (input: unknown) => T,
  fallback: () => Promise<T>
): Promise<T> {
  const draft = await getDraftOverride();
  const section = draftSection(draft, key);
  if (section !== undefined) return coerce(section);
  return fallback();
}

/** 首頁 + 關於我們文案（site_content）── DB 讀取原路徑（T-16 起由下方包裝呼叫） */
const getSiteContentCached = unstable_cache(
  cache(async (): Promise<SiteContent> => {
    const supabase = anonClient();
    if (!supabase) return DEFAULT_CONTENT;

    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "site_content")
      .maybeSingle();

    if (error || !data) return DEFAULT_CONTENT;

    return coerceContent(data.value);
  }),
  ["site-content"],
  { tags: [SITE_CONTENT_TAG], revalidate: 60 }
);

/**
 * 首頁 + 關於我們文案（site_content）。
 * T-16：預覽模式回草稿袋的 content；其餘情況走原 unstable_cache 路徑
 * （無草稿時行為與上線前逐字一致）。
 */
export async function getSiteContent(): Promise<SiteContent> {
  return withDraftOverride("content", coerceContent, getSiteContentCached);
}

/** 導覽選單（site_nav；陣列順序即顯示順序，visible=false 不顯示）── DB 讀取原路徑 */
const getSiteNavCached = unstable_cache(
  cache(async (): Promise<SiteNav> => {
    const supabase = anonClient();
    if (!supabase) return DEFAULT_NAV;

    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "site_nav")
      .maybeSingle();

    if (error || !data) return DEFAULT_NAV;

    return coerceNav(data.value);
  }),
  ["site-nav"],
  { tags: [SITE_NAV_TAG], revalidate: 60 }
);

/**
 * 導覽選單（site_nav）。
 * T-16：預覽模式回草稿袋的 nav；其餘情況走原 unstable_cache 路徑。
 */
export async function getSiteNav(): Promise<SiteNav> {
  return withDraftOverride("nav", coerceNav, getSiteNavCached);
}

/** 頁尾聯絡四欄 + 品牌宣言四行（site_contact）── DB 讀取原路徑 */
const getSiteContactCached = unstable_cache(
  cache(async (): Promise<SiteContact> => {
    const supabase = anonClient();
    if (!supabase) return DEFAULT_CONTACT;

    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "site_contact")
      .maybeSingle();

    if (error || !data) return DEFAULT_CONTACT;

    return coerceContact(data.value);
  }),
  ["site-contact"],
  { tags: [SITE_CONTACT_TAG], revalidate: 60 }
);

/**
 * 頁尾聯絡四欄 + 品牌宣言四行（site_contact）。
 * T-16：預覽模式回草稿袋的 contact；其餘情況走原 unstable_cache 路徑。
 */
export async function getSiteContact(): Promise<SiteContact> {
  return withDraftOverride("contact", coerceContact, getSiteContactCached);
}

/** 九個前台頁面的標題／說明／CTA／空狀態／表單標籤（site_pages）── DB 讀取原路徑 */
const getSitePagesCached = unstable_cache(
  cache(async (): Promise<SitePages> => {
    const supabase = anonClient();
    if (!supabase) return DEFAULT_PAGES;

    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "site_pages")
      .maybeSingle();

    if (error || !data) return DEFAULT_PAGES;

    return coercePages(data.value);
  }),
  ["site-pages"],
  { tags: [SITE_PAGES_TAG], revalidate: 60 }
);

/**
 * 九個前台頁面的標題／說明／CTA／空狀態／表單標籤（site_pages）。
 * T-16：預覽模式回草稿袋的 pages；其餘情況走原 unstable_cache 路徑。
 */
export async function getSitePages(): Promise<SitePages> {
  return withDraftOverride("pages", coercePages, getSitePagesCached);
}

/** 首頁區塊顯隱與排序（site_blocks）── DB 讀取原路徑 */
const getSiteBlocksCached = unstable_cache(
  cache(async (): Promise<SiteBlocks> => {
    const supabase = anonClient();
    if (!supabase) return DEFAULT_BLOCKS;

    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "site_blocks")
      .maybeSingle();

    if (error || !data) return DEFAULT_BLOCKS;

    return coerceBlocks(data.value);
  }),
  ["site-blocks"],
  { tags: [SITE_BLOCKS_TAG], revalidate: 60 }
);

/**
 * 首頁區塊顯隱與排序（site_blocks）。
 * T-16：預覽模式回草稿袋的 blocks；其餘情況走原 unstable_cache 路徑。
 */
export async function getSiteBlocks(): Promise<SiteBlocks> {
  return withDraftOverride("blocks", coerceBlocks, getSiteBlocksCached);
}

/** SEO metadata（site_seo；layout.tsx 的 generateMetadata 由方硯接線，T-12 前端部分）── DB 讀取原路徑 */
const getSiteSeoCached = unstable_cache(
  cache(async (): Promise<SiteSeo> => {
    const supabase = anonClient();
    if (!supabase) return DEFAULT_SEO;

    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "site_seo")
      .maybeSingle();

    if (error || !data) return DEFAULT_SEO;

    return coerceSeo(data.value);
  }),
  ["site-seo"],
  { tags: [SITE_SEO_TAG], revalidate: 60 }
);

/**
 * SEO metadata（site_seo）。
 * T-16：預覽模式回草稿袋的 seo；其餘情況走原 unstable_cache 路徑
 * （layout 的 generateMetadata 在無草稿時行為不變）。
 */
export async function getSiteSeo(): Promise<SiteSeo> {
  return withDraftOverride("seo", coerceSeo, getSiteSeoCached);
}

/**
 * ── 前台公開查詢的快取版本 ──
 *
 * 首頁 / 活動 / 排行榜 / 訓練頁每次載入都會打 Supabase，但呢啲資料
 * 人人睇到嘅都一樣。用不含 cookie 的 anonClient + unstable_cache 包一層，
 * 60 秒內重複訪問唔使再打 DB，大幅縮短 TTFB。
 * （個人化查詢如 getCurrentProfile 照舊每次即時查；後台 admin/* 繼續用
 * 原本無快取嘅版本，確保審核睇到即時資料。）
 */

/** 全站統計（快取 120 秒，首頁用） */
export function getCachedSiteStats(): Promise<SiteStats> {
  return unstable_cache(
    cache(async (): Promise<SiteStats> => {
      const supabase = anonClient();
      if (!supabase) return EMPTY_STATS;
      const { data, error } = await supabase.from("site_stats").select("*").maybeSingle();
      if (error || !data) return EMPTY_STATS;
      return {
        members: Number(data.members ?? 0),
        total_km: Number(data.total_km ?? 0),
        total_runs: Number(data.total_runs ?? 0),
        total_sessions: Number(data.total_sessions ?? 0),
      };
    }),
    ["site-stats"],
    { revalidate: 120 }
  )();
}

/** 即將到來的訓練場次（快取 60 秒，首頁用） */
export function getCachedUpcomingSessions(limit = 4): Promise<TrainingSession[]> {
  return unstable_cache(
    cache(async (): Promise<TrainingSession[]> => {
      const supabase = anonClient();
      if (!supabase) return [];
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("training_sessions")
        .select("*")
        .gte("session_date", today)
        .order("session_date", { ascending: true })
        .limit(limit);
      return (data as TrainingSession[]) ?? [];
    }),
    ["upcoming-sessions", String(limit)],
    { revalidate: 60 }
  )();
}

/** 全部訓練場次（快取 60 秒，前台訓練頁用） */
export function getCachedAllSessions(limit = 60): Promise<TrainingSession[]> {
  return unstable_cache(
    cache(async (): Promise<TrainingSession[]> => {
      const supabase = anonClient();
      if (!supabase) return [];
      const { data } = await supabase
        .from("training_sessions")
        .select("*")
        .order("session_date", { ascending: false })
        .limit(limit);
      return (data as TrainingSession[]) ?? [];
    }),
    ["all-sessions", String(limit)],
    { revalidate: 60 }
  )();
}

/** 已上架活動（快取 60 秒，前台活動頁用） */
export function getCachedPublishedEvents(limit = 50): Promise<Event[]> {
  return unstable_cache(
    cache(async (): Promise<Event[]> => {
      const supabase = anonClient();
      if (!supabase) return [];
      const { data } = await supabase
        .from("events")
        .select("*")
        .eq("status", "published")
        .gte("event_date", todayISO())
        .order("event_date", { ascending: true })
        .order("sort_order", { ascending: false })
        .limit(limit);
      return (data as Event[]) ?? [];
    }),
    ["published-events", String(limit)],
    { revalidate: 60 }
  )();
}

/* =============================================================
 * 付費活動（HYROX）— migration-paid-events-1.sql
 *
 * 篩選口徑：events.series = 'hyrox'（一般活動 series is null，不受影響）。
 * 快取紀律（照 getCachedPublishedEvents 的做法）：
 *   · 只含 published 的查詢 → anonClient + unstable_cache（60 秒 + tag）
 *   · 任何可能含 draft / archived 的查詢 → **不快取**，走帶 cookie 的
 *     createClient()（RLS 決定管理員看得到全部、會員只看得到 published），
 *     否則後台剛存的草稿要等 60 秒才看得到，而且會把草稿內容寫進
 *     跨請求快取（等於外洩）。
 * 寫入端（api/admin/hyrox/events）以 revalidateTag(HYROX_EVENTS_TAG) 失效快取。
 * ============================================================= */

/** HYROX 場次列表的快取 tag（寫入端必須用同一個字串） */
export const HYROX_EVENTS_TAG = "hyrox-events";

/** HYROX 場次需要的欄位（與契約 GET /api/admin/hyrox/events 一致） */
const HYROX_EVENT_COLUMNS =
  "id,title,subtitle,body,event_date,end_date,start_time,end_time,location," +
  "capacity,fee_cents,payment_qr_path,payment_phone,payment_note,status,sort_order,cover_path,series";

/** 前台：已上架的 HYROX 場次（快取 60 秒；event_date 升冪、null 排前） */
function getCachedHyroxEvents(): Promise<HyroxEvent[]> {
  return unstable_cache(
    cache(async (): Promise<HyroxEvent[]> => {
      const supabase = anonClient();
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("events")
        .select(HYROX_EVENT_COLUMNS)
        .eq("series", "hyrox")
        .eq("status", "published")
        .order("event_date", { ascending: true, nullsFirst: true })
        .order("sort_order", { ascending: false })
        .limit(50);
      logQueryError("getCachedHyroxEvents", error);
      return (data as unknown as HyroxEvent[]) ?? [];
    }),
    ["hyrox-events"],
    { tags: [HYROX_EVENTS_TAG], revalidate: 60 }
  )();
}

/**
 * HYROX 場次列表。
 *
 * @param opts.includeArchived
 *   false（預設，前台）：只回 published，走快取。
 *   true（後台）：回全部（draft / published / archived），**不快取**，
 *   排序為「published 優先 → event_date 升冪（null 排前）→ sort_order 降冪」。
 *   依 status 排序在 PostgREST 做不到自訂優先序，故在 JS 內排。
 */
export async function getHyroxEvents(
  opts: { includeArchived?: boolean } = {}
): Promise<HyroxEvent[]> {
  if (!opts.includeArchived) return getCachedHyroxEvents();

  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("events")
    .select(HYROX_EVENT_COLUMNS)
    .eq("series", "hyrox")
    .limit(200);

  logQueryError("getHyroxEvents(includeArchived)", error);

  const rank: Record<string, number> = { published: 0, draft: 1, archived: 2 };
  return ((data as unknown as HyroxEvent[]) ?? []).sort((a, b) => {
    const byStatus = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    if (byStatus !== 0) return byStatus;
    // null（日期待定）排最前
    const ad = a.event_date ?? "";
    const bd = b.event_date ?? "";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (b.sort_order ?? 0) - (a.sort_order ?? 0);
  });
}

/**
 * 單場 HYROX 場次（published 或 archived；快取 60 秒，依 id 分鍵）。
 *
 * 【為什麼放行 archived】往期場次要能在詳情頁 /hyrox/[id] 展示回顧相片，
 * 所以已結束（archived）的場次也必須讀得到。draft 仍然回 null
 * （草稿不對外，也避免前台用猜的 id 撈到未上架內容）。
 * 匿名讀 archived 需搭配 supabase/migration-hyrox-photos.sql §3 的
 * events_select_archived_public 政策，否則 anon 一樣看不到。
 */
export async function getHyroxEventById(id: string): Promise<HyroxEvent | null> {
  // 非 uuid 直接回 null：不讓 Postgres 22P02 變成 500（同 api.ts 的 isUuid 口徑）
  if (!isUuid(id)) return null;

  return unstable_cache(
    cache(async (): Promise<HyroxEvent | null> => {
      const supabase = anonClient();
      if (!supabase) return null;
      const { data, error } = await supabase
        .from("events")
        .select(HYROX_EVENT_COLUMNS)
        .eq("id", id)
        .eq("series", "hyrox")
        .in("status", ["published", "archived"])
        .maybeSingle();
      logQueryError("getHyroxEventById", error);
      return (data as unknown as HyroxEvent) ?? null;
    }),
    ["hyrox-event", id],
    { tags: [HYROX_EVENTS_TAG], revalidate: 60 }
  )();
}

/* =============================================================
 * HYROX 往期場次回顧相片 — supabase/migration-hyrox-photos.sql
 *
 * 前台資料（往期區塊與單場詳情頁）人人看到的一樣，照 getCachedHyroxEvents
 * 的做法走 anonClient + unstable_cache（60 秒 + tag）。
 * 寫入端（api/admin/hyrox/photos）以 revalidateTag 同時失效
 * HYROX_EVENTS_TAG 與 HYROX_PHOTOS_TAG——兩支快取都標了這兩個 tag，
 * 所以新增／刪除一張相片，往期列表的 photo_count 也會跟著更新。
 * ============================================================= */

/** HYROX 相片列表的快取 tag（寫入端必須用同一個字串） */
export const HYROX_PHOTOS_TAG = "hyrox-photos";

/** 單場相片（依 sort_order 升冪、再依建立時間）；查詢失敗回空陣列，頁面照常渲染 */
export async function getEventPhotos(eventId: string): Promise<EventPhoto[]> {
  // 非 uuid 直接回 []：不讓 Postgres 22P02 變成 500（同 getHyroxEventById 口徑）
  if (!isUuid(eventId)) return [];

  return unstable_cache(
    cache(async (): Promise<EventPhoto[]> => {
      const supabase = anonClient();
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("event_photos")
        .select("id,event_id,path,caption,sort_order")
        .eq("event_id", eventId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(200);
      logQueryError("getEventPhotos", error);
      if (error) return [];
      return ((data as EventPhoto[]) ?? []).map((p) => ({
        id: p.id,
        event_id: p.event_id,
        path: p.path,
        caption: p.caption ?? null,
        sort_order: Number(p.sort_order ?? 0),
      }));
    }),
    ["event-photos", eventId],
    { tags: [HYROX_PHOTOS_TAG, HYROX_EVENTS_TAG], revalidate: 60 }
  )();
}

/**
 * 往期場次（series='hyrox' 且 status='archived'），event_date 降冪
 * （最近結束的排最前；日期待定的排最後），並帶每場的相片數 photo_count。
 *
 * photo_count 用 PostgREST 的內嵌聚合 event_photos(count) 一次取回，
 * 不需要 N+1 查詢；攤平時對任何異常形狀（缺欄位、null、非陣列）都回 0，
 * 保證回傳結構穩定（key 一定存在，只是值是 0）。
 */
export async function getHyroxPastEvents(): Promise<HyroxPastEvent[]> {
  return unstable_cache(
    cache(async (): Promise<HyroxPastEvent[]> => {
      const supabase = anonClient();
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("events")
        .select(`${HYROX_EVENT_COLUMNS},photos:event_photos(count)`)
        .eq("series", "hyrox")
        .eq("status", "archived")
        .order("event_date", { ascending: false, nullsFirst: false })
        .order("sort_order", { ascending: false })
        .limit(50);
      logQueryError("getHyroxPastEvents", error);
      if (error) return [];

      type PastRow = HyroxEvent & { photos?: { count: number }[] | null };
      return ((data as unknown as PastRow[]) ?? []).map((row) => {
        const { photos, ...event } = row;
        const count = Array.isArray(photos) ? Number(photos[0]?.count ?? 0) : 0;
        return {
          ...(event as HyroxEvent),
          photo_count: Number.isFinite(count) && count > 0 ? count : 0,
        };
      });
    }),
    ["hyrox-past-events"],
    { tags: [HYROX_EVENTS_TAG, HYROX_PHOTOS_TAG], revalidate: 60 }
  )();
}

/** 月度排行榜（快取 60 秒，首頁 + 排行榜頁用） */
export function getCachedMonthlyLeaderboard(
  month: string,
  limit = 10
): Promise<LeaderRow[]> {
  return unstable_cache(
    cache(async (): Promise<LeaderRow[]> => {
      const supabase = anonClient();
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("monthly_leaderboard")
        .select("user_id, period_month, total_km, runs, display_name, points")
        .eq("period_month", month)
        .order("total_km", { ascending: false })
        .limit(limit);
      if (error || !data?.length) return [];
      type LeaderboardRow = MonthlyStat & {
        display_name: string | null;
        points: number | null;
      };
      return (data as LeaderboardRow[]).map((d) => ({
        user_id: d.user_id,
        name: d.display_name ?? "匿名會員",
        total_km: Number(d.total_km),
        runs: Number(d.runs),
        points: Number(d.points ?? 0),
      }));
    }),
    ["monthly-leaderboard", month, String(limit)],
    { revalidate: 60 }
  )();
}

/** 總排行榜（快取 60 秒，排行榜頁用） */
export function getCachedAllTimeLeaderboard(limit = 20): Promise<LeaderRow[]> {
  return unstable_cache(
    cache(async (): Promise<LeaderRow[]> => {
      const supabase = anonClient();
      if (!supabase) return [];
      const { data } = await supabase
        .from("public_leaderboard")
        .select("id, display_name, avatar_url, points, total_km")
        .order("total_km", { ascending: false })
        .order("points", { ascending: false })
        .limit(limit);
      return ((data as Profile[]) ?? []).map((p) => ({
        user_id: p.id,
        name: p.display_name ?? "匿名會員",
        total_km: Number(p.total_km),
        runs: 0,
        points: p.points,
      }));
    }),
    ["all-time-leaderboard", String(limit)],
    { revalidate: 60 }
  )();
}

/** 前台：已上架且尚未過期的活動（單次查詢上限 50 筆，Q6） */
export async function getPublishedEvents(limit = 50): Promise<Event[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("events")
    .select("*")
    .eq("status", "published")
    .gte("event_date", todayISO())
    .order("event_date", { ascending: true })
    .order("sort_order", { ascending: false })
    .limit(limit);

  return (data as Event[]) ?? [];
}

/** 後台：全部活動（含 draft）；includeArchived=false 時排除已下架 */
export async function getAdminEvents(includeArchived = false): Promise<Event[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  let query = supabase
    .from("events")
    .select("*")
    .order("event_date", { ascending: false })
    .limit(200);

  if (!includeArchived) query = query.neq("status", "archived");

  const { data } = await query;
  return (data as Event[]) ?? [];
}

/** 月度排行榜（依當月已確認公里數） */
export async function getMonthlyLeaderboard(
  month: string = currentMonth(),
  limit = 10
): Promise<LeaderRow[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  // Q3：改用 monthly_leaderboard view（Schema R6 §3），一次拿到統計 + 暱稱 + 積分
  const { data, error } = await supabase
    .from("monthly_leaderboard")
    .select("user_id, period_month, total_km, runs, display_name, points")
    .eq("period_month", month)
    .order("total_km", { ascending: false })
    .limit(limit);

  if (error || !data?.length) return [];

  // monthly_leaderboard view 回傳「統計 + 暱稱 + 積分」，與既有 LeaderRow 完全一致（Q3）
  type LeaderboardRow = MonthlyStat & {
    display_name: string | null;
    points: number | null;
  };

  return (data as LeaderboardRow[]).map((d) => ({
    user_id: d.user_id,
    name: d.display_name ?? "匿名會員",
    total_km: Number(d.total_km),
    runs: Number(d.runs),
    points: Number(d.points ?? 0),
  }));
}

/** 總排行榜（依累積總公里數 + 積分） */
export async function getAllTimeLeaderboard(limit = 20): Promise<LeaderRow[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("public_leaderboard")
    .select("id, display_name, avatar_url, points, total_km")
    .order("total_km", { ascending: false })
    .order("points", { ascending: false })
    .limit(limit);

  return ((data as Profile[]) ?? []).map((p) => ({
    user_id: p.id,
    name: p.display_name ?? "匿名會員",
    total_km: Number(p.total_km),
    runs: 0,
    points: p.points,
  }));
}

/** 某會員某月的累積（只計已確認） */
export async function getUserMonthKm(
  userId: string,
  month: string = currentMonth()
): Promise<{ km: number; runs: number; pendingKm: number }> {
  const supabase = await createClient();
  if (!supabase)
    return { km: 0, runs: 0, pendingKm: 0 };

  const { data } = await supabase
    .from("run_submissions")
    .select("km, status")
    .eq("user_id", userId)
    .eq("period_month", month);

  const rows = (data ?? []) as { km: number; status: string }[];
  const approved = rows.filter((r) => r.status === "approved");
  const pending = rows.filter((r) => r.status === "pending");

  return {
    km: approved.reduce((s, r) => s + Number(r.km), 0),
    runs: approved.length,
    pendingKm: pending.reduce((s, r) => s + Number(r.km), 0),
  };
}

/** 會員自己的提交紀錄 */
export async function getUserSubmissions(
  userId: string,
  limit = 50
): Promise<RunSubmission[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("run_submissions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = (data as RunSubmission[]) ?? [];
  return await attachImageUrls(rows);
}

/** 為提交紀錄產生可讀的圖片網址（私有 bucket 用 signed URL） */
export async function attachImageUrls(
  rows: RunSubmission[]
): Promise<RunSubmission[]> {
  const supabase = await createClient();
  if (!supabase || !rows.length) return rows;

  const paths = rows.map((r) => r.image_path).filter(Boolean);
  if (!paths.length) return rows;

  const { data } = await supabase.storage
    .from("run-screenshots")
    .createSignedUrls(paths, 60 * 60);

  const urlMap = new Map<string, string>();
  (data ?? []).forEach((item) => {
    if (item.path && item.signedUrl) urlMap.set(item.path, item.signedUrl);
  });

  return rows.map((r) => ({ ...r, image_url: urlMap.get(r.image_path) ?? null }));
}

/** 會員的優惠券 */
export async function getUserCoupons(userId: string): Promise<Coupon[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("coupons")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return (data as Coupon[]) ?? [];
}

/** 會員的積分明細 */
export async function getUserPoints(
  userId: string,
  limit = 30
): Promise<PointTransaction[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("point_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data as PointTransaction[]) ?? [];
}

/** 會員的訓練紀錄 */
export async function getUserCheckins(
  userId: string,
  limit = 30
): Promise<TrainingCheckin[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("training_checkins")
    .select("*, session:training_sessions(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data as unknown as TrainingCheckin[]) ?? [];
}

/**
 * 會員自己已報名的活動 id 集合（T-26；/events 的「已報名」狀態）。
 * RLS：event_reg_select_own_or_admin——只讀得到自己的列。
 * 查詢失敗回空陣列（頁面照常渲染，只是全部顯示「站內報名」按鈕）；
 * 開發模式下印出錯誤，避免靜默失敗。
 */
export async function getMyEventRegistrations(userId: string): Promise<string[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("event_registrations")
    .select("event_id")
    .eq("user_id", userId)
    .eq("status", "registered");

  logQueryError("getMyEventRegistrations", error);
  return ((data as { event_id: string }[]) ?? []).map((r) => r.event_id);
}

/**
 * 會員自己的 HYROX 報名（含付款狀態／審核備註／報名表三題），給 /dashboard 顯示。
 *
 * 不快取（個人化資料）。RLS 的 event_reg_select_own_or_admin 已限制只能讀自己的列，
 * 這裡再帶 user_id 條件，雙重把關。
 * 付款截圖只回 path、不回 URL：會員端不需要看自己的截圖，也避免簽出多餘的連結。
 */
export async function getMyHyroxRegistrations(
  userId: string
): Promise<HyroxRegistration[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("event_registrations")
    .select(
      "id,event_id,user_id,status,payment_status,payment_proof_path," +
        "payment_amount_cents,group_pref,weekly_freq,longest_run," +
        "disclaimer_accepted_at,reviewed_by,reviewed_at,admin_note,created_at," +
        "event:events(id,title,series,event_date,end_date,start_time,location," +
        "fee_cents,payment_phone,payment_note,status,cover_path)"
    )
    .eq("user_id", userId)
    .eq("status", "registered")
    .order("created_at", { ascending: false })
    .limit(50);

  logQueryError("getMyHyroxRegistrations", error);

  // 同一支查詢會連免費活動的報名一起取回；HYROX 頁只列系列場次
  return ((data as unknown as HyroxRegistration[]) ?? []).filter(
    (r) => r.event?.series === "hyrox"
  );
}

/* ================= 後台查詢 ================= */
/**
 * 注意：run_submissions 有兩條指向 profiles 的外鍵（user_id / reviewed_by），
 * training_checkins 也有兩條（user_id / confirmed_by）。
 * PostgREST 必須用 `!外鍵約束名` 明確指定，否則會回 PGRST201 歧義錯誤。
 */
const RUN_PROFILE = "profile:profiles!run_submissions_user_id_fkey(id, display_name, avatar_url)";
const CHECKIN_PROFILE = "profile:profiles!training_checkins_user_id_fkey(id, display_name)";

/** 開發模式下把被吞掉的查詢錯誤印出來，避免又出現「頁面空白但沒報錯」 */
function logQueryError(where: string, error: { message: string } | null) {
  if (error && process.env.NODE_ENV !== "production") {
    console.error(`[queries] ${where} failed:`, error.message);
  }
}

export async function getPendingSubmissions(): Promise<RunSubmission[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("run_submissions")
    .select(`*, ${RUN_PROFILE}`)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);

  logQueryError("getPendingSubmissions", error);
  return await attachImageUrls((data as unknown as RunSubmission[]) ?? []);
}

export async function getSubmissionsByStatus(
  status: "pending" | "approved" | "rejected",
  limit = 100
): Promise<RunSubmission[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("run_submissions")
    .select(`*, ${RUN_PROFILE}`)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(limit);

  logQueryError("getSubmissionsByStatus", error);
  return await attachImageUrls((data as unknown as RunSubmission[]) ?? []);
}

export async function getPendingCheckins(): Promise<TrainingCheckin[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("training_checkins")
    .select(`*, session:training_sessions(*), ${CHECKIN_PROFILE}`)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);

  logQueryError("getPendingCheckins", error);
  return (data as unknown as TrainingCheckin[]) ?? [];
}

/** 全部會員（後台手動發券用） */
export async function getAllMembers(): Promise<
  { id: string; display_name: string | null }[]
> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("profiles")
    .select("id, display_name")
    .order("created_at", { ascending: true })
    .limit(500);

  return (data as { id: string; display_name: string | null }[]) ?? [];
}

export interface QualifiedRow {
  user_id: string;
  name: string | null;
  email: string | null;
  total_km: number;
  runs: number;
  has_coupon: boolean;
}

/** 後台：某月達標名單（≥300km） */
export async function getQualifiedList(
  month: string = currentMonth()
): Promise<QualifiedRow[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("monthly_qualified_list", {
    p_month: month,
  });
  if (error || !data) return [];

  return ((data as unknown as QualifiedRow[]) ?? []).map((r) => ({
    ...r,
    total_km: Number(r.total_km),
    runs: Number(r.runs),
  }));
}

/** 後台：某月所有人的累積（含未達標，供參考） */
export async function getMonthOverview(month: string = currentMonth()) {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("monthly_running_stats")
    .select("user_id, period_month, total_km, runs")
    .eq("period_month", month)
    .order("total_km", { ascending: false })
    .limit(200);

  const rows = (data as MonthlyStat[]) ?? [];
  if (!rows.length) return [];

  const ids = rows.map((r) => r.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", ids);
  const pmap = new Map<string, string>(
    ((profiles as Profile[]) ?? []).map((p) => [p.id, p.display_name ?? "匿名"])
  );

  return rows.map((r) => ({ ...r, name: pmap.get(r.user_id) ?? "匿名" }));
}

export async function getAllCoupons(limit = 200): Promise<Coupon[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("coupons")
    // 2026-09-25 修復：coupons 有兩個 FK 指向 profiles（user_id、redeemed_by），
    // 不加 hint 會觸發 PGRST201「more than one relationship」導致整表查回空陣列，
    // 後台總覽顯示 3 張、列表卻顯示 0 張。明確指定走 user_id 的 FK。
    .select("*, profile:profiles!coupons_user_id_fkey(id, display_name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data as unknown as Coupon[]) ?? [];
}

export async function getAdminCounts() {
  const supabase = await createClient();
  if (!supabase)
    return { pendingRuns: 0, pendingCheckins: 0, coupons: 0, members: 0 };

  const [{ count: pendingRuns }, { count: pendingCheckins }, { count: coupons }, { count: members }] =
    await Promise.all([
      supabase
        .from("run_submissions")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("training_checkins")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("coupons")
        .select("*", { count: "exact", head: true })
        .eq("status", "active"),
      supabase.from("profiles").select("*", { count: "exact", head: true }),
    ]);

  return {
    pendingRuns: pendingRuns ?? 0,
    pendingCheckins: pendingCheckins ?? 0,
    coupons: coupons ?? 0,
    members: members ?? 0,
  };
}

export { monthLabel };

/* =============================================================
   教練資料（2026-09-29）
   ⚠️ 需先執行 supabase/migration-coaches.sql 建立 coaches 表
   ============================================================= */

export interface Coach {
  id: string;
  name: string;
  specialty: string | null;
  bio: string | null;
  photo_path: string | null;
  sort_order: number;
  is_visible: boolean;
}

/**
 * 前台用：只取 is_visible = true 的教練，依 sort_order 排序。
 * 用 anonClient（RLS 的 coaches_select_public 政策保證只讀得到已顯示的）。
 * 若表尚未建立或查詢失敗，回傳空陣列（頁面會顯示「待補充」而不會壞掉）。
 */
export function getVisibleCoaches(limit = 50): Promise<Coach[]> {
  return unstable_cache(
    cache(async (): Promise<Coach[]> => {
      const supabase = anonClient();
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("coaches")
        .select("id, name, specialty, bio, photo_path, sort_order, is_visible")
        .eq("is_visible", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error || !data?.length) return [];
      return (data as Coach[]).map((c) => ({
        id: c.id,
        name: c.name,
        specialty: c.specialty ?? null,
        bio: c.bio ?? null,
        photo_path: c.photo_path ?? null,
        sort_order: Number(c.sort_order ?? 0),
        is_visible: true,
      }));
    }),
    ["visible-coaches", String(limit)],
    { revalidate: 60 }
  )();
}
