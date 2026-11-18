/**
 * src/lib/races.ts — 賽事系統的查詢層（第一階段：賽事外殼 + 報名）
 *
 * 資料來源：supabase/migration-races.sql
 *   events（series='race'，+6 個新欄位）｜race_categories｜race_registrations
 *   ｜race_entries｜四個只出數字的檢視
 *
 * 【降級是硬要求（本檔最重要的一條規則）】
 * 站主沒有 service_role key，DDL 只能由他在 Supabase Dashboard 手動貼 SQL 執行。
 * 也就是說：**程式碼可能比資料庫先上線**，這段時間裡新欄位／新表／新檢視都不存在。
 * 因此本檔每一個查詢函式都必須「回傳空值」而不是拋錯：
 *   · 欄位不存在 → PostgREST 回 PGRST204（或 Postgres 42703）
 *   · 表／檢視不存在 → PGRST205 / 42P01（PostgREST 訊息含 schema cache）
 * 判斷集中在 isSchemaMissing()，命中就寫一行 server log 後回空值，
 * 讓前台照常渲染（數字顯示 0、區塊自動消失），不會整頁 500。
 *
 * 【為什麼公開查詢用 anonClient 而不是 createClient】
 * 照 src/lib/queries.ts 的既有做法：公開頁要能吃 unstable_cache、
 * 不能因為 cookies() 被迫轉動態；賽事數字對所有人相同，匿名讀取即可。
 * 會員自己的報名（含姓名電話）走 createClient（帶 cookie、受 RLS 限制），不快取。
 *
 * 【快取】
 * tag RACES_TAG（= "races"），60 秒；寫入端（src/app/api/admin/races/**）
 * 以 revalidateTag(RACES_TAG, { expire: 60 }) 立即失效。
 *
 * Owner：白客（backend-engineer）
 */

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { anonClient } from "./supabase/anon";
import { createClient } from "./supabase/server";
import { isUuid } from "./api";
import { todayISO } from "./utils";
import type {
  MyRaceRegistration,
  RaceCategory,
  RaceCategorySummaryRow,
  RaceDaySummaryRow,
  RaceEvent,
  RaceLogisticsRow,
  RaceSummaryRow,
} from "./types";

/* =============================================================
 * 共用常數
 * ============================================================= */

/** 賽事系列的 series 值（一般活動為 null、HYROX 為 'hyrox'） */
export const RACE_SERIES = "race";

/** 快取 tag：寫入端必須用同一個字串呼叫 revalidateTag */
export const RACES_TAG = "races";

/** 對外可見的賽事狀態（draft / archived / published 不對外） */
export const PUBLIC_RACE_STATUSES = ["open", "closed", "photos"] as const;

/**
 * 賽事要抓的欄位。
 * 明確列出而不是 `select("*")`：一來避免把 created_by 之類的內部欄位帶到前端，
 * 二來新欄位若還不存在，PostgREST 會明確回 PGRST204（可被 isSchemaMissing 攔到），
 * 比 `*` 靜默少欄位好除錯。
 */
const RACE_COLUMNS =
  "id,title,subtitle,body,event_date,end_date,start_time,end_time,location," +
  "capacity,registration_url,registration_note,cover_path,status,series,sort_order," +
  "fee_cents,album_url,album_label,promo_on_home,promo_note,registration_deadline," +
  "logistics_note,created_by,created_at,updated_at";

/** 空彙總：檢視不存在時的降級值（前台顯示 0，不顯示錯誤） */
const EMPTY_SUMMARY: RaceSummaryRow = {
  event_id: "",
  registrations: 0,
  entries: 0,
  bus_seats: 0,
  lodging_people: 0,
  lodging_nights: 0,
};

const EMPTY_LOGISTICS: RaceLogisticsRow = {
  event_id: "",
  bus_people: 0,
  bus_seats: 0,
  lodging_people: 0,
  lodging_nights: 0,
};

/* =============================================================
 * 降級判斷
 * ============================================================= */

type ErrorLike = { code?: unknown; message?: unknown; details?: unknown };

/**
 * 是否為「資料庫結構還沒跟上程式碼」的錯誤。
 *
 * 涵蓋：
 *   · 42P01 undefined_table      —— 表不存在（raw SQL／RPC 路徑）
 *   · 42703 undefined_column     —— 欄位不存在（migration 只跑了一半）
 *   · PGRST204 column not found  —— PostgREST 在 schema cache 找不到欄位
 *   · PGRST205 table not found   —— PostgREST 在 schema cache 找不到表／檢視
 *   · message 含 "schema cache" / "does not exist" 的舊版 PostgREST 字串
 */
export function isSchemaMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as ErrorLike;
  const code = typeof e.code === "string" ? e.code : "";
  if (code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205") {
    return true;
  }
  const message = typeof e.message === "string" ? e.message : "";
  return /schema cache|does not exist/i.test(message);
}

/** 只在開發環境印錯誤（與 queries.ts 的 logQueryError 同口徑） */
function logQueryError(where: string, error: { message: string } | null) {
  if (error && process.env.NODE_ENV !== "production") {
    console.error(`[races] ${where} failed:`, error.message);
  }
}

/** 降級時寫一行 log（production 也寫，方便站主知道「SQL 還沒跑」） */
function logDegrade(where: string, error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error);
  console.warn(
    `[races] ${where} 降級為空值（可能是 supabase/migration-races.sql 尚未執行）：`,
    message
  );
}

/* =============================================================
 * 賽事（events，series='race'）
 * ============================================================= */

/**
 * 主頁賽事帶：promo_on_home = true、status 在 open/closed、且賽事還沒結束的最近一場。
 *
 * 「還沒結束」的判定同時容許單日賽事（end_date 為 null）：
 *   end_date >= today  or  (end_date is null and event_date >= today)
 * 只取 1 筆（主頁帶狀卡本來就只放一場）；同分時 event_date 早的優先。
 *
 * 降級：新欄位不存在 → 回 null（主頁自動不顯示賽事帶）。
 */
function getCachedRacePromo(): Promise<RaceEvent | null> {
  return unstable_cache(
    cache(async (): Promise<RaceEvent | null> => {
      const supabase = anonClient();
      if (!supabase) return null;

      const today = todayISO();
      const { data, error } = await supabase
        .from("events")
        .select(RACE_COLUMNS)
        .eq("series", RACE_SERIES)
        .eq("promo_on_home", true)
        .in("status", ["open", "closed"])
        .or(`end_date.gte.${today},and(end_date.is.null,event_date.gte.${today})`)
        .order("event_date", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        if (isSchemaMissing(error)) {
          logDegrade("getActiveRacePromo", error);
          return null;
        }
        logQueryError("getActiveRacePromo", error);
        return null;
      }

      return (data as unknown as RaceEvent) ?? null;
    }),
    ["race-promo"],
    { tags: [RACES_TAG], revalidate: 60 }
  )();
}

/** 主頁賽事帶（見 getCachedRacePromo）；永遠不拋錯 */
export function getActiveRacePromo(): Promise<RaceEvent | null> {
  return getCachedRacePromo().catch((err) => {
    logDegrade("getActiveRacePromo(cache)", err);
    return null;
  });
}

/**
 * 以 id（或 slug）取單場賽事。
 *
 * 【關於 slug】events 目前沒有 slug 欄位（線上真實欄位清單見 migration-races.sql 檔頭），
 * 所以這裡的行為是：
 *   · 合法 uuid → 用 id 查
 *   · 其他字串 → 直接回 null（不送進 Postgres，避免 22P02 變成 500）
 * 日後若加了 slug 欄位，只要在下面補一條 .eq("slug", …) 的分支即可，
 * 函式簽名與呼叫端都不用改。
 *
 * 查詢用 anonClient：公開賽事詳情頁人人看到的一樣，可走快取。
 * 降級：新欄位不存在 → 回 null。
 */
export function getRaceBySlugOrId(idOrSlug: string): Promise<RaceEvent | null> {
  const key = (idOrSlug ?? "").trim();
  if (!isUuid(key)) return Promise.resolve(null);

  return unstable_cache(
    cache(async (): Promise<RaceEvent | null> => {
      const supabase = anonClient();
      if (!supabase) return null;

      const { data, error } = await supabase
        .from("events")
        .select(RACE_COLUMNS)
        .eq("id", key)
        .eq("series", RACE_SERIES)
        .in("status", [...PUBLIC_RACE_STATUSES])
        .maybeSingle();

      if (error) {
        if (isSchemaMissing(error)) {
          logDegrade("getRaceBySlugOrId", error);
          return null;
        }
        logQueryError("getRaceBySlugOrId", error);
        return null;
      }

      return (data as unknown as RaceEvent) ?? null;
    }),
    ["race-event", key],
    { tags: [RACES_TAG], revalidate: 60 }
  )().catch((err) => {
    logDegrade("getRaceBySlugOrId(cache)", err);
    return null;
  });
}

/**
 * 某場賽事的組別（依日期、再依 sort_order）。
 * 降級：表不存在 → 回 []（前台不顯示組別區塊，其餘照常）。
 */
export function getRaceCategories(eventId: string): Promise<RaceCategory[]> {
  const key = (eventId ?? "").trim();
  if (!isUuid(key)) return Promise.resolve([]);

  return unstable_cache(
    cache(async (): Promise<RaceCategory[]> => {
      const supabase = anonClient();
      if (!supabase) return [];

      const { data, error } = await supabase
        .from("race_categories")
        .select("id,event_id,day,name,team_size,fee_cents,sort_order,created_at")
        .eq("event_id", key)
        .order("day", { ascending: true })
        .order("sort_order", { ascending: true })
        .limit(200);

      if (error) {
        if (isSchemaMissing(error)) {
          logDegrade("getRaceCategories", error);
          return [];
        }
        logQueryError("getRaceCategories", error);
        return [];
      }

      return (data as unknown as RaceCategory[]) ?? [];
    }),
    ["race-categories", key],
    { tags: [RACES_TAG], revalidate: 60 }
  )().catch((err) => {
    logDegrade("getRaceCategories(cache)", err);
    return [];
  });
}

/* =============================================================
 * 數字（四個檢視）—— 公開頁只能讀這些，不含任何姓名
 * ============================================================= */

/** 每場賽事的彙總（race_summary）。降級：回全 0 的物件（不是 null） */
export async function getRaceSummary(eventId: string): Promise<RaceSummaryRow> {
  const key = (eventId ?? "").trim();
  if (!isUuid(key)) return { ...EMPTY_SUMMARY };

  return getCachedRaceSummary(key);
}

const getCachedRaceSummary = (eventId: string): Promise<RaceSummaryRow> =>
  unstable_cache(
    cache(async (): Promise<RaceSummaryRow> => {
      const supabase = anonClient();
      if (!supabase) return { ...EMPTY_SUMMARY, event_id: eventId };

      const { data, error } = await supabase
        .from("race_summary")
        .select("event_id,registrations,entries,bus_seats,lodging_people,lodging_nights")
        .eq("event_id", eventId)
        .maybeSingle();

      if (error) {
        if (isSchemaMissing(error)) {
          logDegrade("getRaceSummary", error);
          return { ...EMPTY_SUMMARY, event_id: eventId };
        }
        logQueryError("getRaceSummary", error);
        return { ...EMPTY_SUMMARY, event_id: eventId };
      }
      if (!data) return { ...EMPTY_SUMMARY, event_id: eventId };

      const row = data as unknown as RaceSummaryRow;
      return {
        event_id: eventId,
        registrations: Number(row.registrations ?? 0),
        entries: Number(row.entries ?? 0),
        bus_seats: Number(row.bus_seats ?? 0),
        lodging_people: Number(row.lodging_people ?? 0),
        lodging_nights: Number(row.lodging_nights ?? 0),
      };
    }),
    ["race-summary", eventId],
    { tags: [RACES_TAG], revalidate: 60 }
  )().catch((err) => {
    logDegrade("getRaceSummary(cache)", err);
    return { ...EMPTY_SUMMARY, event_id: eventId };
  });

/** 賽事 × 日期彙總（race_day_summary）。降級：回 [] */
export async function getRaceDaySummary(eventId: string): Promise<RaceDaySummaryRow[]> {
  const key = (eventId ?? "").trim();
  if (!isUuid(key)) return [];
  return getCachedRaceDaySummary(key);
}

const getCachedRaceDaySummary = (eventId: string): Promise<RaceDaySummaryRow[]> =>
  unstable_cache(
    cache(async (): Promise<RaceDaySummaryRow[]> => {
      const supabase = anonClient();
      if (!supabase) return [];

      const { data, error } = await supabase
        .from("race_day_summary")
        .select("event_id,day,registrations,entries")
        .eq("event_id", eventId)
        .order("day", { ascending: true });

      if (error) {
        if (isSchemaMissing(error)) {
          logDegrade("getRaceDaySummary", error);
          return [];
        }
        logQueryError("getRaceDaySummary", error);
        return [];
      }

      return ((data as unknown as RaceDaySummaryRow[]) ?? []).map((r) => ({
        event_id: eventId,
        day: r.day,
        registrations: Number(r.registrations ?? 0),
        entries: Number(r.entries ?? 0),
      }));
    }),
    ["race-day-summary", eventId],
    { tags: [RACES_TAG], revalidate: 60 }
  )().catch((err) => {
    logDegrade("getRaceDaySummary(cache)", err);
    return [];
  });

/** 賽事 × 日期 × 組別彙總（race_category_summary）。降級：回 [] */
export async function getRaceCategorySummary(
  eventId: string
): Promise<RaceCategorySummaryRow[]> {
  const key = (eventId ?? "").trim();
  if (!isUuid(key)) return [];
  return getCachedRaceCategorySummary(key);
}

const getCachedRaceCategorySummary = (
  eventId: string
): Promise<RaceCategorySummaryRow[]> =>
  unstable_cache(
    cache(async (): Promise<RaceCategorySummaryRow[]> => {
      const supabase = anonClient();
      if (!supabase) return [];

      const { data, error } = await supabase
        .from("race_category_summary")
        .select("event_id,day,category_id,name,registrations,entries")
        .eq("event_id", eventId)
        .order("day", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        if (isSchemaMissing(error)) {
          logDegrade("getRaceCategorySummary", error);
          return [];
        }
        logQueryError("getRaceCategorySummary", error);
        return [];
      }

      return ((data as unknown as RaceCategorySummaryRow[]) ?? []).map((r) => ({
        event_id: eventId,
        day: r.day,
        category_id: r.category_id,
        name: r.name,
        registrations: Number(r.registrations ?? 0),
        entries: Number(r.entries ?? 0),
      }));
    }),
    ["race-category-summary", eventId],
    { tags: [RACES_TAG], revalidate: 60 }
  )().catch((err) => {
    logDegrade("getRaceCategorySummary(cache)", err);
    return [];
  });

/**
 * 後勤彙總（race_logistics）：需巴士人數／座位、需住宿人數／晚數。
 * 給後台訂車訂房看，不含任何姓名。降級：回全 0 的物件。
 */
export async function getRaceLogistics(eventId: string): Promise<RaceLogisticsRow> {
  const key = (eventId ?? "").trim();
  if (!isUuid(key)) return { ...EMPTY_LOGISTICS };

  const supabase = anonClient();
  if (!supabase) return { ...EMPTY_LOGISTICS, event_id: key };

  const { data, error } = await supabase
    .from("race_logistics")
    .select("event_id,bus_people,bus_seats,lodging_people,lodging_nights")
    .eq("event_id", key)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      logDegrade("getRaceLogistics", error);
      return { ...EMPTY_LOGISTICS, event_id: key };
    }
    logQueryError("getRaceLogistics", error);
    return { ...EMPTY_LOGISTICS, event_id: key };
  }
  if (!data) return { ...EMPTY_LOGISTICS, event_id: key };

  const row = data as unknown as RaceLogisticsRow;
  return {
    event_id: key,
    bus_people: Number(row.bus_people ?? 0),
    bus_seats: Number(row.bus_seats ?? 0),
    lodging_people: Number(row.lodging_people ?? 0),
    lodging_nights: Number(row.lodging_nights ?? 0),
  };
}

/* =============================================================
 * 會員自己的報名（含姓名電話 → 走帶 cookie 的 client、不快取）
 * ============================================================= */

/**
 * 目前登入者自己的賽事報名（含人次與組別）。
 *
 * RLS：race_registrations_select_own_or_admin 只放行 user_id = auth.uid()，
 * 這裡再顯式加 .eq("user_id", userId) 是第二道（萬一政策被改壞）。
 *
 * 降級：表不存在 → 回 []；userId 非 uuid → 回 []（不讓 22P02 變 500）。
 */
export async function getMyRaceRegistrations(userId: string): Promise<MyRaceRegistration[]> {
  const uid = (userId ?? "").trim();
  if (!isUuid(uid)) return [];

  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("race_registrations")
    .select(
      "id,event_id,user_id,full_name,phone,gender,needs_bus,bus_seats," +
        "needs_lodging,lodging_people,lodging_nights,payment_proof_path," +
        "payment_status,status,member_note,admin_note,created_at,updated_at," +
        "race_entries(id,category_id,teammate_names," +
        "race_categories(id,name,day,team_size,fee_cents))"
    )
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    if (isSchemaMissing(error)) {
      logDegrade("getMyRaceRegistrations", error);
      return [];
    }
    logQueryError("getMyRaceRegistrations", error);
    return [];
  }

  type Raw = MyRaceRegistration & {
    race_entries?: Array<{
      id: string;
      category_id: string;
      teammate_names: string | null;
      race_categories?: {
        id: string;
        name: string;
        day: string;
        team_size: number;
        fee_cents: number;
      } | null;
    }>;
  };

  return ((data as unknown as Raw[]) ?? []).map((row) => {
    const entries = (row.race_entries ?? []).map((e) => ({
      id: e.id,
      category_id: e.category_id,
      teammate_names: e.teammate_names ?? null,
      category: e.race_categories ?? null,
    }));
    return {
      id: row.id,
      event_id: row.event_id,
      user_id: row.user_id,
      full_name: row.full_name,
      phone: row.phone,
      gender: row.gender ?? null,
      needs_bus: Boolean(row.needs_bus),
      bus_seats: Number(row.bus_seats ?? 0),
      needs_lodging: Boolean(row.needs_lodging),
      lodging_people: Number(row.lodging_people ?? 0),
      lodging_nights: Number(row.lodging_nights ?? 0),
      payment_proof_path: row.payment_proof_path ?? null,
      payment_status: row.payment_status,
      status: row.status,
      member_note: row.member_note ?? null,
      admin_note: row.admin_note ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      entries,
    };
  });
}
