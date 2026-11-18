/**
 * src/app/api/admin/races/_shared.ts — 賽事後台 API 的共用驗證與錯誤出口
 *
 * Owner：白客（backend-engineer）。不是 route（檔名不以 route.ts 結尾）。
 *
 * 【為什麼要有這一支】
 * 七個賽事端點都要做同樣四件事：欄位白名單驗證、uuid 檢查、DB 錯誤脫敏、
 * 「SQL 還沒跑」的降級。集中在這裡才能保證每個端點的上下界一字不差。
 *
 * 【四個必查安全項落在哪】
 *   · 越權：每個 route 第一行 authorizeAdmin()（未設定 400／未登入 401／非管理員 403）。
 *   · IDOR：所有 id 先 isUuid；賽事一律再驗 series='race'（不能拿別的活動的 id 操作）。
 *   · 參數：長度上限與 DB 的 check 約束逐條對齊（見下方常數與 migration-races.sql §1–§2）；
 *           數字類有上下界，列舉類逐值比對。
 *   · 分頁：page / size 都有上下界（見 parsePage / parseSize），絕不全量返回。
 *
 * 【錯誤訊息】
 * 一律繁中、給終端使用者看；不含 SQL、資料表名、檔案路徑、資料庫原文。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonErr, jsonInternal, jsonNotFound } from "@/lib/api";

/* =============================================================
 * 常數（與 supabase/migration-races.sql 的 check 約束一一對應）
 * ============================================================= */

/** events 既有欄位的長度上限（schema-r6.sql:18-29） */
export const TITLE_MAX = 120;
export const SUBTITLE_MAX = 200;
export const BODY_MAX = 5000;
export const LOCATION_MAX = 120;
export const REG_NOTE_MAX = 300;
export const URL_MAX = 500;
export const TIME_MAX = 20;

/** events 新欄位的長度上限（migration-races.sql §1.1） */
export const PROMO_NOTE_MAX = 120;
export const ALBUM_LABEL_MAX = 20;
export const LOGISTICS_MAX = 2000;

/** 數值上下界（schema-r6.sql:26 與 migration-races.sql §2） */
export const CAPACITY_MIN = 1;
export const CAPACITY_MAX = 99999;
export const FEE_MIN = 0;
export const FEE_MAX = 10000000;
export const SORT_MIN = -9999;
export const SORT_MAX = 9999;
export const TEAM_SIZE_MIN = 1;
export const TEAM_SIZE_MAX = 8;
export const CATEGORY_NAME_MAX = 60;
export const NOTE_MAX = 1000;
export const TEAMMATE_MAX = 200;
export const DEADLINE_MAX = 40;

/** 賽事狀態（寫入白名單）。'published' 刻意不接受寫入，避免語意混淆。 */
export const WRITABLE_RACE_STATUSES = [
  "draft",
  "open",
  "closed",
  "photos",
  "archived",
] as const;
export type WritableRaceStatus = (typeof WRITABLE_RACE_STATUSES)[number];

/** 報名狀態 / 付款狀態（PATCH 審核端點的白名單） */
export const REG_STATUSES = ["submitted", "confirmed", "needs_info", "cancelled"] as const;
export const PAYMENT_STATUSES = ["not_required", "pending", "approved", "rejected"] as const;

/** 名單端點的分頁邊界（size 上限 200：後台一頁最多 200 人，超過就要翻頁） */
export const PAGE_MIN = 1;
export const PAGE_MAX = 10000;
export const SIZE_MIN = 1;
export const SIZE_MAX = 200;
export const SIZE_DEFAULT = 50;

/** 賽事列要回給前端的欄位（與 src/lib/races.ts 的 RACE_COLUMNS 必須一致） */
export const RACE_EVENT_COLUMNS =
  "id,title,subtitle,body,event_date,end_date,start_time,end_time,location," +
  "capacity,registration_url,registration_note,cover_path,status,series,sort_order," +
  "fee_cents,album_url,album_label,promo_on_home,promo_note,registration_deadline," +
  "logistics_note,created_by,created_at,updated_at";

/** 付款截圖私有桶（與 hryox 共用 run-screenshots；見 src/app/api/hyrox/_shared/contract.ts） */
export const PROOF_BUCKET = "run-screenshots";
/** signed URL 有效期（秒）＝ 1 小時 */
export const PROOF_URL_TTL = 60 * 60;

export const RACE_NOT_FOUND_MSG = "找不到這場賽事。";
export const CATEGORY_NOT_FOUND_MSG = "找不到這個組別。";
export const REGISTRATION_NOT_FOUND_MSG = "找不到這筆報名。";

/* =============================================================
 * 錯誤出口
 * ============================================================= */

type ErrorLike = { code?: unknown; message?: unknown };

function errCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const code = (error as ErrorLike).code;
  return typeof code === "string" ? code : "";
}

/**
 * 是否為「資料庫結構還沒跟上程式碼」的錯誤（站主還沒跑 migration）。
 *
 *   · 42P01 / PGRST205 → 表或檢視不存在
 *   · 42703 / PGRST204 → 欄位不存在（events 的 6 個新欄位還沒加）
 *   · message 含 schema cache / does not exist → 舊版 PostgREST 的字串
 */
export function isSchemaMissing(error: unknown): boolean {
  const code = errCode(error);
  if (code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST205") {
    return true;
  }
  const message =
    typeof error === "object" && error !== null && typeof (error as ErrorLike).message === "string"
      ? String((error as ErrorLike).message)
      : "";
  return /schema cache|does not exist/i.test(message);
}

/**
 * DB 錯誤的統一出口（脫敏）：
 *   · 結構未更新 → 400 SCHEMA_OUTDATED（附上要跑哪個檔案，但不含 DB 原文）
 *   · 外鍵違反 23503 → 404（不讓使用者看到 23503）
 *   · 其餘 → 500，原文只寫 server log
 */
export function dbFail(where: string, error: unknown) {
  if (isSchemaMissing(error)) {
    console.error(`[api] ${where} 資料庫結構未更新：`, error);
    return jsonErr(
      "賽事資料表尚未建立或欄位不齊，請先在 Supabase SQL Editor 執行 supabase/migration-races.sql。",
      "SCHEMA_OUTDATED",
      400
    );
  }
  if (errCode(error) === "23503") {
    console.error(`[api] ${where} 外鍵違反：`, error);
    return jsonNotFound("找不到對應的賽事或組別。");
  }
  return jsonInternal(where, error);
}

/* =============================================================
 * 基本型別解析
 * ============================================================= */

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/** 以 code point 計長，中文／emoji 不會被算成 2 個字 */
function cpLength(s: string): number {
  return Array.from(s).length;
}

/** YYYY-MM-DD 且是真實存在的日期（擋掉 2026-02-31） */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === value;
}

/** YYYY-MM-DD 加減天數（用 UTC 做，不受伺服器時區影響） */
export function addDays(dateOnly: string, days: number): string {
  const t = Date.parse(`${dateOnly}T00:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 兩個 YYYY-MM-DD 相差幾天 */
export function diffDays(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
  );
}

/** 文字欄位解析結果 */
type TextResult = { provided: boolean; value: string | null };

function takeText(
  body: Record<string, unknown>,
  key: string,
  max: number,
  fields: Record<string, string>,
  label: string,
  opts: { required?: boolean; url?: boolean } = {}
): TextResult {
  if (!has(body, key)) return { provided: false, value: null };

  const raw = body[key];
  if (raw === null || raw === undefined) {
    if (opts.required) fields[key] = `請填寫${label}。`;
    return { provided: true, value: null };
  }
  if (typeof raw !== "string") {
    fields[key] = `${label}格式錯誤。`;
    return { provided: true, value: null };
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    if (opts.required) fields[key] = `請填寫${label}。`;
    return { provided: true, value: null };
  }
  if (cpLength(trimmed) > max) {
    fields[key] = `${label}最多 ${max} 個字。`;
    return { provided: true, value: null };
  }
  if (opts.url && !/^https?:\/\//i.test(trimmed)) {
    fields[key] = `${label}必須是 http／https 開頭的網址。`;
    return { provided: true, value: null };
  }
  return { provided: true, value: trimmed };
}

type IntResult = { provided: boolean; value: number | null };

function takeInt(
  body: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  fields: Record<string, string>,
  label: string,
  opts: { nullable?: boolean } = {}
): IntResult {
  if (!has(body, key)) return { provided: false, value: null };

  const raw = body[key];
  if (raw === null) {
    if (!opts.nullable) {
      fields[key] = `${label}不可為空。`;
      return { provided: true, value: null };
    }
    return { provided: true, value: null };
  }

  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;

  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    fields[key] = `${label}必須是整數。`;
    return { provided: true, value: null };
  }
  if (n < min || n > max) {
    fields[key] = `${label}必須介於 ${min} 到 ${max} 之間。`;
    return { provided: true, value: null };
  }
  return { provided: true, value: n };
}

/* =============================================================
 * 賽事欄位（events）白名單解析
 * ============================================================= */

export type RaceFieldValues = Record<string, unknown>;

export type ParseRaceFieldsResult =
  | { ok: true; values: RaceFieldValues }
  | { ok: false; fields: Record<string, string> };

/**
 * 解析並驗證賽事欄位（只認白名單，其餘一律忽略——不盲寫 body）。
 *
 * 對外欄位名是 start_date / end_date，寫進 DB 時映射成 event_date / end_date。
 * @param mode create：title 與 start_date 必填；update：全部選填（沒給就不寫）
 */
export function parseRaceFields(
  body: Record<string, unknown>,
  mode: "create" | "update"
): ParseRaceFieldsResult {
  const fields: Record<string, string> = {};
  const values: RaceFieldValues = {};

  const put = (column: string, result: { provided: boolean; value: unknown }) => {
    if (result.provided) values[column] = result.value;
  };

  /* title（create 必填） */
  if (mode === "create" && !has(body, "title")) {
    fields.title = "請填寫賽事名稱。";
  } else {
    put("title", takeText(body, "title", TITLE_MAX, fields, "賽事名稱", { required: mode === "create" }));
  }

  put("subtitle", takeText(body, "subtitle", SUBTITLE_MAX, fields, "副標題"));
  put("body", takeText(body, "body", BODY_MAX, fields, "賽事介紹"));
  put("location", takeText(body, "location", LOCATION_MAX, fields, "地點"));
  put(
    "registration_url",
    takeText(body, "registration_url", URL_MAX, fields, "外部報名網址", { url: true })
  );
  put("registration_note", takeText(body, "registration_note", REG_NOTE_MAX, fields, "報名說明"));
  put("start_time", takeText(body, "start_time", TIME_MAX, fields, "開始時間"));
  put("end_time", takeText(body, "end_time", TIME_MAX, fields, "結束時間"));
  put("promo_note", takeText(body, "promo_note", PROMO_NOTE_MAX, fields, "主頁帶文案"));
  put("album_label", takeText(body, "album_label", ALBUM_LABEL_MAX, fields, "相簿按鈕文字"));
  put("album_url", takeText(body, "album_url", URL_MAX, fields, "相簿網址", { url: true }));
  put("logistics_note", takeText(body, "logistics_note", LOGISTICS_MAX, fields, "後勤說明"));

  /* 日期 */
  if (has(body, "start_date")) {
    const raw = body.start_date;
    if (isDateOnly(raw)) values.event_date = raw;
    else fields.start_date = "開始日必須是 YYYY-MM-DD 格式的合法日期。";
  } else if (mode === "create") {
    fields.start_date = "請填寫開始日。";
  }

  if (has(body, "end_date")) {
    const raw = body.end_date;
    if (raw === null || raw === "") values.end_date = null;
    else if (isDateOnly(raw)) values.end_date = raw;
    else fields.end_date = "結束日必須是 YYYY-MM-DD 格式的合法日期。";
  }

  /* 數字 */
  put("capacity", takeInt(body, "capacity", CAPACITY_MIN, CAPACITY_MAX, fields, "名額", { nullable: true }));
  if (has(body, "fee_cents")) {
    put("fee_cents", takeInt(body, "fee_cents", FEE_MIN, FEE_MAX, fields, "報名費（分）"));
  }
  if (has(body, "sort_order")) {
    put("sort_order", takeInt(body, "sort_order", SORT_MIN, SORT_MAX, fields, "排序"));
  }

  /* 報名截止時間（timestamptz；接受 ISO 字串或空值） */
  if (has(body, "registration_deadline")) {
    const raw = body.registration_deadline;
    if (raw === null || raw === "") {
      values.registration_deadline = null;
    } else if (typeof raw !== "string" || raw.length > DEADLINE_MAX || Number.isNaN(Date.parse(raw))) {
      fields.registration_deadline = "報名截止時間格式錯誤。";
    } else {
      values.registration_deadline = raw;
    }
  }

  /* 主頁賽事帶開關 */
  if (has(body, "promo_on_home")) {
    const raw = body.promo_on_home;
    if (typeof raw !== "boolean") fields.promo_on_home = "主頁曝光必須是布林值。";
    else values.promo_on_home = raw;
  }

  /* 狀態（白名單） */
  if (has(body, "status")) {
    const raw = body.status;
    if (typeof raw !== "string" || !(WRITABLE_RACE_STATUSES as readonly string[]).includes(raw)) {
      fields.status = `狀態只接受 ${WRITABLE_RACE_STATUSES.join("／")}。`;
    } else {
      values.status = raw;
    }
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, values };
}

/**
 * 日期區間檢查（需要「即將寫入的值 + 既有值」一起看，所以獨立成函式）。
 * @returns 錯誤欄位物件；合法時回空物件
 */
export function checkDateRange(
  nextStart: string | null | undefined,
  nextEnd: string | null | undefined
): Record<string, string> {
  if (!nextStart || !nextEnd) return {};
  if (nextEnd < nextStart) return { end_date: "結束日不可早於開始日。" };
  return {};
}

/* =============================================================
 * 分頁參數
 * ============================================================= */

/**
 * 解析正整數查詢參數。
 * 缺省／空字串 → fallback；非數字（含負號、小數、空白）→ null（呼叫端回 400）。
 * 註：故意不接受 "-1" 這種寫法，讓 page=-1 明確變成 400 而不是被 abs 掉。
 */
export function parseIntParam(raw: string | null, fallback: number): number | null {
  if (raw === null) return fallback;
  const trimmed = raw.trim();
  if (trimmed === "") return fallback;
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

/* =============================================================
 * 賽事守門（IDOR）
 * ============================================================= */

export type RaceGuardRow = {
  id: string;
  title: string;
  event_date: string;
  end_date: string | null;
  series: string | null;
  status: string;
};

/**
 * 確認這個 id 真的是一場賽事（series='race'）。
 * 不存在、「不是賽事系列」一律回 null（不揭露該 id 屬於別的模組）。
 */
export async function loadRace(
  supabase: SupabaseClient,
  eventId: string
): Promise<{ row: RaceGuardRow | null; error: unknown }> {
  const { data, error } = await supabase
    .from("events")
    .select("id,title,event_date,end_date,series,status")
    .eq("id", eventId)
    .maybeSingle();

  if (error) return { row: null, error };
  const row = (data as unknown as RaceGuardRow | null) ?? null;
  if (!row || row.series !== "race") return { row: null, error: null };
  return { row, error: null };
}
