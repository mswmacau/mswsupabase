/**
 * src/app/races/_data.ts — HYROX 賽事公開頁的【暫時】資料讀取層（第一階段）
 *
 * ⚠️ 這一支是暫時的。
 *   第二階段站主的 `@/lib/races`（白客，已存在）就緒後，
 *   **只需要改動本檔**：把下面的查詢換成 import { getActiveRacePromo,
 *   getRaceBySlugOrId, getRaceSummary, getRaceCategorySummary } from "@/lib/races"，
 *   對外函式簽名（getPromoRace / getRace / listRaces）與 Race 型別維持不變，
 *   呼叫端（src/app/page.tsx、src/app/races/**）完全不用動。
 *   第一階段刻意不 import `@/lib/races`：它與 migration 同步在改，且站主要求
 *   前台這一段先獨立可跑。
 *
 * 資料契約（對齊 supabase/migration-races.sql，非猜測）：
 *   events          +6 欄位：album_url / album_label / promo_on_home /
 *                   promo_note / registration_deadline / logistics_note
 *                   status 放寬為 draft|published|archived|open|closed|photos
 *   race_summary    (event_id, registrations, entries, bus_seats, …) 只出數字
 *   race_category_summary (event_id, day, name, registrations, …) 只出數字
 *   **events 沒有 slug 欄位** → 對外 slug 一律用 id（uuid），
 *     日後加了 slug 欄位只要改 mapRow 一行。
 *
 * 【降級是硬要求】站主的 SQL 還沒跑，程式碼比資料庫先上線：
 *   欄位不存在 → PostgREST 回 42703 / PGRST204
 *   表或檢視不存在 → PGRST205 / 42P01
 *   本檔一律「回空值」，不拋錯、不 console.error（驗收要求 console 0 error），
 *   前台區塊自動消失、頁面照常渲染。
 *
 * 【隱私紅線】
 *   只讀彙總檢視（race_summary / race_category_summary），它們只輸出 count/sum，
 *   不含姓名、電話、user_id。**絕不**自己數 event_registrations 的筆數——
 *   migration-event-registrations.sql:100 的 RLS 只讓本人或 admin select，
 *   anon 角色會拿到 0 筆（實測 HTTP 200 + 空陣列），那會變成假的「已報 0 人」。
 */

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonClient } from "@/lib/supabase/anon";

/* =====================================================================
 * 對外型別（第二階段換資料來源時不可改）
 * ===================================================================== */

/** 前台可見的三種狀態；draft / archived / published 一律 notFound() */
export type RaceStatus = "open" | "closed" | "photos";

export type RaceDivision = { name: string; count: number };

/** date 為 "YYYY-MM-DD" */
export type RaceDay = { date: string; divisions: RaceDivision[] };

/**
 * 彙總數字。欄位為 null 代表「該格拿不到」，前台個別隱藏；
 * 整個 stats 為 null 代表「彙總檢視不存在」，前台整塊隱藏（絕不顯示 0）。
 */
export type RaceStats = {
  registered: number | null;
  totalEntries: number | null;
  busSeats: number | null;
};

export type Race = {
  id: string;
  /** 目前等於 id（events 沒有 slug 欄位） */
  slug: string;
  title: string;
  location: string | null;
  /** "YYYY-MM-DD" */
  dateStart: string;
  /** "YYYY-MM-DD"，單日賽事為 null */
  dateEnd: string | null;
  status: RaceStatus;
  albumUrl: string | null;
  /** 後台可自訂的相簿按鈕文字；null 時前台用預設「睇比賽相片」 */
  albumLabel: string | null;
  logisticsNote: string | null;
  feeNote: string | null;
  notice: string | null;
  body: string | null;
  /** null = promo_on_home 欄位不存在（DDL 未執行） */
  promoOnHome: boolean | null;
  stats: RaceStats | null;
  schedule: RaceDay[] | null;
};

/* =====================================================================
 * 日期（沿用站內慣例：src/lib/utils.ts:79 的 formatDate 是 2026/11/20）
 * 手動解析字串、不經 Date 時區轉換，避免跨時區掉一天。
 * ===================================================================== */

type Ymd = { y: number; m: number; d: number };

function parseYmd(iso: string | null | undefined): Ymd | null {
  if (!iso) return null;
  const hit = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!hit) return null;
  const y = Number(hit[1]);
  const m = Number(hit[2]);
  const d = Number(hit[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 長版：2026 年 11 月 20 日–22 日（賽事頁標題區用） */
export function formatRaceDate(r: Pick<Race, "dateStart" | "dateEnd">): string {
  const a = parseYmd(r.dateStart);
  if (!a) return "";
  const b = parseYmd(r.dateEnd);
  const head = `${a.y} 年 ${a.m} 月 ${a.d} 日`;
  if (!b) return head;
  if (b.y === a.y && b.m === a.m && b.d === a.d) return head;
  if (b.y === a.y && b.m === a.m) return `${head}–${b.d} 日`;
  if (b.y === a.y) return `${head}–${b.m} 月 ${b.d} 日`;
  return `${head}–${b.y} 年 ${b.m} 月 ${b.d} 日`;
}

/** 短版：2026/11/20–11/22（首頁賽事帶、列表卡用） */
export function formatRaceDateCompact(
  r: Pick<Race, "dateStart" | "dateEnd">
): string {
  const a = parseYmd(r.dateStart);
  if (!a) return "";
  const head = `${a.y}/${pad2(a.m)}/${pad2(a.d)}`;
  const b = parseYmd(r.dateEnd);
  if (!b) return head;
  if (b.y === a.y && b.m === a.m && b.d === a.d) return head;
  if (b.y === a.y && b.m === a.m) return `${head}–${pad2(b.d)}`;
  if (b.y === a.y) return `${head}–${pad2(b.m)}/${pad2(b.d)}`;
  return `${head}–${b.y}/${pad2(b.m)}/${pad2(b.d)}`;
}

/** 澳門時區的今天（"YYYY-MM-DD"）。不依賴執行環境時區。 */
export function macauToday(): string {
  try {
    // en-CA 的日期格式剛好是 YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Macau",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/* =====================================================================
 * dev 假資料（正式行為永遠是從 DB 讀）
 *
 * 假資料的「內容」不在 repo、也不在 bundle 裡：
 * 只從環境變數 DEV_FAKE_RACE_JSON 讀 JSON 陣列（量測時才注入）。
 * 關閉方式：
 *   1. 不設 DEV_FAKE_RACE_JSON → 完全走 DB（正式行為）。
 *   2. NODE_ENV === "production" 時，即使設了也直接忽略（硬 gate）。
 * 所以 production build 內不存在任何假賽事字串（實測：掃 .next 為 0 命中）。
 * ===================================================================== */

function devFakeRaces(): Race[] {
  if (process.env.NODE_ENV === "production") return [];
  const raw = process.env.DEV_FAKE_RACE_JSON;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRace).map((r) => ({
      ...r,
      stats: r.stats ?? null,
      schedule: r.schedule ?? null,
      albumLabel: r.albumLabel ?? null,
      promoOnHome: r.promoOnHome ?? true,
    }));
  } catch {
    return [];
  }
}

function isRace(v: unknown): v is Race {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.slug === "string" &&
    typeof o.title === "string" &&
    typeof o.dateStart === "string" &&
    (o.status === "open" || o.status === "closed" || o.status === "photos")
  );
}

/* =====================================================================
 * 欄位正規化小工具
 * ===================================================================== */

type Row = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))
    return Number(v);
  return null;
}

/** http/https 以外一律視為沒有（擋 javascript: 之類的 scheme） */
function safeUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** 分 → 「MOP 1,280」（fee_cents 以分為單位） */
function formatFeeCents(cents: number | null): string | null {
  if (cents === null || cents <= 0) return null;
  const amount = cents / 100;
  const text = Number.isInteger(amount)
    ? amount.toLocaleString("en-US")
    : amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
  return `報名費 MOP ${text}`;
}

/* =====================================================================
 * events 讀取（三段式欄位探測）
 *
 * 實測到的三種狀態：
 *   FULL：migration-races.sql 執行後（+6 欄位）
 *   MID ：只有 series / fee_cents / registration_note（目前線上的狀態）
 *   BASE：更早期的 schema（連 series 都沒有）
 * 一定要讀到 series：現有兩筆「MSW 戶外 HYROX」的 series 是 'hyrox'（月度活動），
 * 只有 series='race' 才是賽事，不能靠標題猜。
 * ===================================================================== */

const FULL_COLUMNS = [
  "id",
  "title",
  "body",
  "location",
  "event_date",
  "end_date",
  "status",
  "series",
  "registration_note",
  "fee_cents",
  "album_url",
  "album_label",
  "promo_on_home",
  "registration_deadline",
  "logistics_note",
].join(",");

const MID_COLUMNS = [
  "id",
  "title",
  "body",
  "location",
  "event_date",
  "end_date",
  "status",
  "series",
  "registration_note",
  "fee_cents",
].join(",");

const BASE_COLUMNS = [
  "id",
  "title",
  "body",
  "location",
  "event_date",
  "end_date",
  "status",
].join(",");

type Loaded = { rows: Row[]; seriesKnown: boolean };

async function selectRows(
  supabase: SupabaseClient,
  columns: string
): Promise<Row[] | null> {
  const { data, error } = await supabase.from("events").select(columns);
  if (error) return null;
  return (data as unknown as Row[] | null) ?? [];
}

async function loadRaces(supabase: SupabaseClient): Promise<Loaded> {
  const full = await selectRows(supabase, FULL_COLUMNS);
  if (full) return { rows: full, seriesKnown: true };

  const mid = await selectRows(supabase, MID_COLUMNS);
  if (mid) return { rows: mid, seriesKnown: true };

  const base = await selectRows(supabase, BASE_COLUMNS);
  if (base) return { rows: base, seriesKnown: false };

  return { rows: [], seriesKnown: true };
}

/**
 * status → 前台三態。
 *   open / closed / photos → 原樣
 *   published             → open（舊資料相容）
 *   draft / archived / 其他 → null（不公開）
 * 另外：status='open' 但已過 registration_deadline → 視為 closed
 *   （與 migration 的 race_event_accepting() 同口徑，避免顯示一顆報不了的按鈕）
 */
function toStatus(raw: unknown, deadlineRaw: unknown): RaceStatus | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s !== "open" && s !== "closed" && s !== "photos") {
    return s === "published" ? "open" : null;
  }
  if (s === "open") {
    const deadline = str(deadlineRaw);
    if (deadline) {
      const t = Date.parse(deadline);
      if (Number.isFinite(t) && t < Date.now()) return "closed";
    }
  }
  return s;
}

/** 只有 series='race' 才是賽事；series 讀不到時退回標題判斷（更早期 schema） */
function isRaceRow(row: Row, seriesKnown: boolean): boolean {
  if (seriesKnown) return str(row.series) === "race";
  return /hyrox/i.test(String(row.title ?? ""));
}

function mapRow(row: Row): Race | null {
  const status = toStatus(row.status, row.registration_deadline);
  if (!status) return null;

  const title = str(row.title);
  const dateStart = str(row.event_date)?.slice(0, 10) ?? null;
  const id = str(row.id);
  if (!title || !dateStart || !id) return null;

  const endRaw = str(row.end_date)?.slice(0, 10) ?? null;

  return {
    id,
    // events 沒有 slug 欄位 → 用 id；日後新增 slug 只要改這一行
    slug: id,
    title,
    location: str(row.location),
    dateStart,
    dateEnd: endRaw && endRaw >= dateStart ? endRaw : null,
    status,
    albumUrl: safeUrl(row.album_url),
    albumLabel: str(row.album_label),
    logisticsNote: str(row.logistics_note),
    feeNote: formatFeeCents(num(row.fee_cents)),
    notice: str(row.registration_note),
    body: str(row.body),
    promoOnHome:
      typeof row.promo_on_home === "boolean" ? row.promo_on_home : null,
    stats: null,
    schedule: null,
  };
}

async function loadAll(supabase: SupabaseClient): Promise<Race[]> {
  const { rows, seriesKnown } = await loadRaces(supabase);
  return rows
    .filter((row) => isRaceRow(row, seriesKnown))
    .map(mapRow)
    .filter((r): r is Race => r !== null);
}

/* =====================================================================
 * 彙總數字：只讀 race_summary（security definer 檢視，只出數字）
 * 檢視不存在 → null → 前台整塊不顯示
 * ===================================================================== */

let summaryAvailable: boolean | null = null;

async function loadStats(
  supabase: SupabaseClient,
  eventId: string
): Promise<RaceStats | null> {
  if (summaryAvailable === false) return null;

  const { data, error } = await supabase
    .from("race_summary")
    .select("registrations,entries,bus_seats")
    .eq("event_id", eventId)
    .maybeSingle();

  if (error) {
    summaryAvailable = false;
    return null;
  }
  summaryAvailable = true;
  if (!data) return null;

  const row = data as unknown as Row;
  const registered = num(row.registrations);
  const totalEntries = num(row.entries);
  const busSeats = num(row.bus_seats);
  if (registered === null && totalEntries === null && busSeats === null)
    return null;

  return { registered, totalEntries, busSeats };
}

/* =====================================================================
 * 日程與組別：只讀 race_category_summary（event_id, day, name, registrations）
 * 檢視不存在 → null → 前台整塊不顯示
 * ===================================================================== */

let categorySummaryAvailable: boolean | null = null;

async function loadSchedule(
  supabase: SupabaseClient,
  eventId: string
): Promise<RaceDay[] | null> {
  if (categorySummaryAvailable === false) return null;

  // 檢視只有 day / name / registrations（不含 sort_order），故只按日期排
  const { data, error } = await supabase
    .from("race_category_summary")
    .select("day,name,registrations")
    .eq("event_id", eventId)
    .order("day", { ascending: true });

  if (error) {
    categorySummaryAvailable = false;
    return null;
  }
  categorySummaryAvailable = true;
  if (!Array.isArray(data) || data.length === 0) return null;

  const days = new Map<string, RaceDivision[]>();
  for (const item of data as Row[]) {
    const date = str(item.day)?.slice(0, 10);
    const name = str(item.name);
    if (!date || !name) continue;
    const list = days.get(date) ?? [];
    list.push({ name, count: num(item.registrations) ?? 0 });
    days.set(date, list);
  }

  if (days.size === 0) return null;
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, divisions]) => ({ date, divisions }));
}

/* =====================================================================
 * 對外 API
 * ===================================================================== */

/**
 * 主頁賽事帶：只放「站主指定要上主頁」（promo_on_home）且仍在報名的最近一場。
 *   · promo_on_home 欄位不存在（DDL 未執行）→ 退化成「任何 open 賽事」
 *   · 沒有 open 賽事 → null（主頁整塊不渲染）
 */
export const getPromoRace = cache(async (): Promise<Race | null> => {
  const today = macauToday();

  const fake = devFakeRaces();
  if (fake.length > 0) return pickPromo(fake, today);

  const supabase = anonClient();
  if (!supabase) return null;

  const races = await loadAll(supabase);
  const promo = pickPromo(races, today);
  if (!promo) return null;

  return { ...promo, stats: await loadStats(supabase, promo.id) };
});

function pickPromo(races: Race[], today: string): Race | null {
  const promoMarked = races.some((r) => r.promoOnHome === true);
  const candidates = races
    .filter((r) => r.status === "open")
    .filter((r) => (promoMarked ? r.promoOnHome === true : true))
    .filter((r) => (r.dateEnd ?? r.dateStart) >= today)
    .sort((a, b) => (a.dateStart < b.dateStart ? -1 : 1));
  return candidates[0] ?? null;
}

/** 取單場賽事；不存在 / draft / archived 一律 null（頁面 notFound()） */
export const getRace = cache(async (slug: string): Promise<Race | null> => {
  const key = slug.trim();
  if (!key) return null;

  const fake = devFakeRaces();
  if (fake.length > 0) return fake.find((r) => r.slug === key) ?? null;

  const supabase = anonClient();
  if (!supabase) return null;

  const races = await loadAll(supabase);
  const race = races.find((r) => r.slug === key);
  if (!race) return null;

  const [stats, schedule] = await Promise.all([
    loadStats(supabase, race.id),
    loadSchedule(supabase, race.id),
  ]);
  return { ...race, stats, schedule };
});

/** 「更多相簿」一列（event_album_links；方案 §3.2 相簿多連結） */
export type RaceAlbumLink = {
  id: string;
  url: string;
  /** 按鈕文字，如「攝影師 A」（管理端命名，1–40 字） */
  label: string;
};

/**
 * 該場賽事的相簿連結清單（sort_order 升冪，0–5 筆）。
 *
 * 前台只渲染外開按鈕（雲相簿的 X-Frame-Options 全擋 iframe，方案 §3.1
 * 定案不做嵌入）。主相簿 events.album_url 的大按鈕不動，這是它下面的
 * 「更多相簿」按鈕列。
 *
 * 降級同本檔慣例：表未建（migration 未跑）／任何錯誤 → []，
 * 按鈕列整段不渲染（驗收：console 0 error、無 JS 前台零殘缺）。
 */
export const getRaceAlbumLinks = cache(
  async (eventId: string): Promise<RaceAlbumLink[]> => {
    if (!eventId) return [];
    const supabase = anonClient();
    if (!supabase) return [];
    try {
      const { data } = await supabase
        .from("event_album_links")
        .select("id,url,label")
        .eq("event_id", eventId)
        .order("sort_order", { ascending: true })
        .limit(5);
      return ((data as unknown as RaceAlbumLink[]) ?? []).filter(
        (l) => typeof l.url === "string" && /^https?:\/\//.test(l.url)
      );
    } catch {
      return [];
    }
  }
);

/**
 * 報名表需要的「賽事層」付款資訊（不屬於公開頁的 Race 型別，故意另開一支）。
 *
 * 為什麼不併進 getRace()：`Race` 是公開頁三個消費端共用的型別，
 * 為了一張報名表去動它會波及首頁賽事帶與列表頁；而且這三欄（fee_cents /
 * payment_qr_path / registration_deadline）只有報名表要看。
 *
 * 【降級】任何錯誤（欄位不存在、賽事不可見、連線失敗）→ 全部回 null，
 *   報名表就當「這場沒有賽事層費用、沒有收款碼」處理：不顯示付款區塊。
 *   不拋錯、不 console.error（驗收要求 console 0 error）。
 */
export type RaceRegisterMeta = {
  /** 賽事層費用（分）；null = 讀不到 */
  feeCents: number | null;
  /** 收款二維碼在 site-assets 內的相對路徑；null = 站主沒設 */
  paymentQrPath: string | null;
  /** 報名截止時間（ISO 字串，供顯示用） */
  deadline: string | null;
};

const EMPTY_REGISTER_META: RaceRegisterMeta = {
  feeCents: null,
  paymentQrPath: null,
  deadline: null,
};

export const getRaceRegisterMeta = cache(
  async (eventId: string): Promise<RaceRegisterMeta> => {
    const key = (eventId ?? "").trim();
    if (!key) return { ...EMPTY_REGISTER_META };

    const supabase = anonClient();
    if (!supabase) return { ...EMPTY_REGISTER_META };

    const { data, error } = await supabase
      .from("events")
      .select("fee_cents,payment_qr_path,registration_deadline")
      .eq("id", key)
      .maybeSingle();

    if (error || !data) return { ...EMPTY_REGISTER_META };

    const row = data as unknown as Row;
    return {
      feeCents: num(row.fee_cents),
      paymentQrPath: str(row.payment_qr_path),
      deadline: str(row.registration_deadline),
    };
  }
);

const byDateDesc = (a: Race, b: Race) =>
  a.dateStart < b.dateStart ? 1 : a.dateStart > b.dateStart ? -1 : 0;

/** 列表頁：open / closed / photos，按日期倒序 */
export const listRaces = cache(async (): Promise<Race[]> => {
  const fake = devFakeRaces();
  if (fake.length > 0) return [...fake].sort(byDateDesc);

  const supabase = anonClient();
  if (!supabase) return [];

  const races = await loadAll(supabase);
  return races.sort(byDateDesc);
});
