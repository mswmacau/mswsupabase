/**
 * src/app/admin/events/race-admin-data.ts — 賽事後台（?tab=races）的伺服器資料層
 *
 * Owner：方砚（frontend-engineer）
 *
 * 【為什麼直接查 Supabase，而不是打一支 API】
 * 管理端只有寫入端點（POST /api/admin/races、PATCH/DELETE、duplicate、categories、
 * registrations），**沒有 GET 列表端點**（/api/admin/races 的 GET 是 405）。
 * 所以列表資料由伺服器元件直接查，寫入仍一律走既有 API（快取失效與稽核都在那裡）。
 *
 * 【降級是硬規則】
 * 站主把 SQL 貼進 Supabase 的時機不一定，程式碼可能比資料庫先上線。
 * migration-races.sql §4 的四個檢視（race_summary / race_category_summary /
 * race_logistics）可能不存在。這裡每一支查詢都「回空值 + 一行 server log」，
 * 不 throw、不整頁 500：
 *   · events / race_categories 讀不到 → 列表空（表一定存在，因為 series 欄位已上線）
 *   · 彙總檢視讀不到 → summaryAvailable=false，UI 顯示「—」而不是 0
 *     （0 會被誤讀成「真的沒有人報名」，這是比缺資料更糟的假象）
 */

import { createClient } from "@/lib/supabase/server";
import type {
  AdminRace,
  AdminRaceCategory,
  RaceCategoryCount,
  RaceSummaryNumbers,
} from "./race-types";

/** 與 src/lib/races.ts 的 RACE_COLUMNS 一致；明確列出，不用 select("*") */
const RACE_COLUMNS =
  "id,title,subtitle,body,event_date,end_date,start_time,end_time,location,capacity," +
  "registration_url,registration_note,cover_path,status,sort_order,fee_cents," +
  "album_url,album_label,promo_on_home,promo_note,registration_deadline," +
  "logistics_note,created_at,updated_at";

/** 後台一次最多列幾場（超過就該做分頁了，但 200 場對單一站主足夠） */
const RACE_LIMIT = 200;
/** 組別一次最多抓幾列（一場賽事通常 5–30 個組別） */
const CATEGORY_LIMIT = 1000;
/** 彙總檢視一次最多抓幾列（與 RACE_LIMIT 同步） */
const SUMMARY_LIMIT = 500;
/** 日期×組別明細一次最多抓幾列（200 場 × 30 組別已是上限的餘裕） */
const CATEGORY_SUMMARY_LIMIT = 2000;

type RaceRow = Omit<AdminRace, "categories" | "summary" | "categoryCounts">;

type SummaryRow = {
  event_id: string;
  registrations: number | null;
  entries: number | null;
  bus_seats: number | null;
  lodging_people: number | null;
  lodging_nights: number | null;
};

type LogisticsRow = {
  event_id: string;
  bus_people: number | null;
};

type CategoryCountRow = {
  event_id: string;
  day: string;
  category_id: string;
  name: string;
  registrations: number | null;
  entries: number | null;
};

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 取回全部賽事（含 draft / archived）、每個賽事的組別、彙總數字與日期×組別明細。
 *
 * 呼叫端是 `/admin/events?tab=races` 的伺服器元件（force-dynamic，不快取），
 * 所以剛存檔／剛刪組別，重整即可看到最新結果。
 */
export async function getAdminRaces(): Promise<{
  races: AdminRace[];
  summaryAvailable: boolean;
}> {
  const supabase = await createClient();
  if (!supabase) return { races: [], summaryAvailable: false };

  /* ── 1. 賽事本體 ─────────────────────────────────────────── */
  const { data: raceData, error: raceErr } = await supabase
    .from("events")
    .select(RACE_COLUMNS)
    .eq("series", "race")
    .order("event_date", { ascending: false })
    .limit(RACE_LIMIT);

  if (raceErr) {
    console.warn("[admin-races] 賽事列表讀取失敗：", raceErr.message);
    return { races: [], summaryAvailable: false };
  }

  const rows = (raceData as unknown as RaceRow[]) ?? [];
  if (rows.length === 0) return { races: [], summaryAvailable: true };

  const ids = rows.map((r) => r.id);

  /* ── 2. 組別（一次批次查詢，避免 N+1）─────────────────────── */
  const { data: catData, error: catErr } = await supabase
    .from("race_categories")
    .select("id,event_id,day,name,team_size,fee_cents,sort_order")
    .in("event_id", ids)
    .order("day", { ascending: true })
    .order("sort_order", { ascending: true })
    .limit(CATEGORY_LIMIT);

  if (catErr) console.warn("[admin-races] 組別讀取失敗：", catErr.message);
  const categories = (catData as unknown as AdminRaceCategory[]) ?? [];

  /* ── 3. 彙總數字（檢視；缺檢視 → summary 一律 null）────────── */
  const { data: sumData, error: sumErr } = await supabase
    .from("race_summary")
    .select("event_id,registrations,entries,bus_seats,lodging_people,lodging_nights")
    .limit(SUMMARY_LIMIT);

  const summaryAvailable = !sumErr;
  if (sumErr) {
    console.warn(
      "[admin-races] race_summary 讀取失敗（列表改為不顯示人數，請確認已執行 supabase/migration-races.sql）：",
      sumErr.message
    );
  }

  const summaryMap = new Map<string, SummaryRow>();
  for (const row of (sumData as unknown as SummaryRow[]) ?? []) {
    summaryMap.set(row.event_id, row);
  }

  /* ── 4. 需巴士人數（race_logistics 才有；缺檢視 → 0）────────── */
  const { data: logData, error: logErr } = await supabase
    .from("race_logistics")
    .select("event_id,bus_people")
    .limit(SUMMARY_LIMIT);

  if (logErr) console.warn("[admin-races] race_logistics 讀取失敗：", logErr.message);
  const busPeopleMap = new Map<string, number>();
  for (const row of (logData as unknown as LogisticsRow[]) ?? []) {
    busPeopleMap.set(row.event_id, num(row.bus_people));
  }

  /* ── 5. 日期×組別明細（left join，0 人的組別也會出現）──────── */
  const { data: countData, error: countErr } = await supabase
    .from("race_category_summary")
    .select("event_id,day,category_id,name,registrations,entries")
    .limit(CATEGORY_SUMMARY_LIMIT);

  if (countErr) {
    console.warn("[admin-races] race_category_summary 讀取失敗：", countErr.message);
  }
  const countRows = (countData as unknown as CategoryCountRow[]) ?? [];

  /* ── 6. 組裝 ─────────────────────────────────────────────── */
  const catByEvent = new Map<string, AdminRaceCategory[]>();
  for (const c of categories) {
    const list = catByEvent.get(c.event_id) ?? [];
    list.push(c);
    catByEvent.set(c.event_id, list);
  }

  const countByEvent = new Map<string, RaceCategoryCount[]>();
  for (const c of countRows) {
    const list = countByEvent.get(c.event_id) ?? [];
    list.push({
      category_id: c.category_id,
      day: c.day,
      name: c.name,
      registrations: num(c.registrations),
      entries: num(c.entries),
    });
    countByEvent.set(c.event_id, list);
  }

  const races: AdminRace[] = rows.map((row) => {
    const s = summaryMap.get(row.id);
    const summary: RaceSummaryNumbers | null = s
      ? {
          registrations: num(s.registrations),
          entries: num(s.entries),
          bus_people: busPeopleMap.get(row.id) ?? 0,
          bus_seats: num(s.bus_seats),
          lodging_people: num(s.lodging_people),
          lodging_nights: num(s.lodging_nights),
        }
      : null;

    return {
      ...row,
      promo_on_home: Boolean(row.promo_on_home),
      categories: catByEvent.get(row.id) ?? [],
      summary,
      categoryCounts: (countByEvent.get(row.id) ?? []).sort((a, b) =>
        a.day === b.day ? a.name.localeCompare(b.name) : a.day < b.day ? -1 : 1
      ),
    };
  });

  return { races, summaryAvailable };
}
