/**
 * src/app/api/races/_shared.ts — 賽事「會員端」API 的共用驗證與錯誤出口
 *
 * Owner：白客（backend-engineer）。檔名不以 route.ts 結尾，不是端點。
 *
 * 【與後台 `src/app/api/admin/races/_shared.ts` 的關係】
 * 錯誤脫敏（dbFail）、bucket 常數直接重用後台那份，保證兩邊口徑一字不差；
 * 會員端專屬的東西（登入者、報名表白名單、付款截圖上載驗證）放這裡。
 *
 * 【四個必查安全項落在哪】
 *   · 越權：每個 handler 第一行 requireMember()（未設定 400／未登入 401）。
 *   · IDOR：動態路由的 id 先 isUuid；查 registration 一律
 *           `.eq("event_id", …).eq("user_id", user.id)` 雙條件（RLS 之外的第二道）。
 *           user_id / event_id / status / payment_status / id 一律不接受 body 指定。
 *   · 參數：長度與上下界逐條對齊 supabase/migration-races.sql §2 的 check 約束
 *           （會員端比 DB 更嚴：full_name 2–60、phone 6–20 且只含數字/+/-/空格）。
 *   · 分頁：本模組端點沒有分頁參數（一律單筆／本人資料）。
 *
 * 【錯誤訊息】
 * 一律繁中、給終端使用者看；不含 SQL、資料表名、檔案路徑、資料庫原文。
 */

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isUuid,
  jsonErr,
  jsonNotConfigured,
  jsonUnauthenticated,
} from "@/lib/api";

/* =============================================================
 * 常數（與 supabase/migration-races.sql §2 的 check 約束對齊）
 * ============================================================= */

/** 姓名：DB 是 1–60，會員端要求 2–60（單字名不擋，但一個字明顯是誤填） */
export const FULL_NAME_MIN = 2;
export const FULL_NAME_MAX = 60;

/** 電話：DB 是 5–30，會員端 6–20 且只允許數字／+／-／空格 */
export const PHONE_MIN = 6;
export const PHONE_MAX = 20;
export const PHONE_RE = /^[0-9+\- ]+$/;

/** 性別（列舉；會員端視為必填，因為賽事分組要用） */
export const GENDERS = ["male", "female"] as const;
export type Gender = (typeof GENDERS)[number];

/** 巴士座位 / 住宿人數 / 晚數（DB check 同值） */
export const BUS_SEATS_MIN = 1;
export const BUS_SEATS_MAX = 20;
export const LODGING_PEOPLE_MIN = 1;
export const LODGING_PEOPLE_MAX = 20;
export const LODGING_NIGHTS_MIN = 1;
export const LODGING_NIGHTS_MAX = 30;

/** 一次報名最多勾幾個組別（人次層） */
export const ENTRIES_MIN = 1;
export const ENTRIES_MAX = 8;

/** 隊友名（DB check ≤ 200） */
export const TEAMMATE_MAX = 200;

/** 會員備註（DB check ≤ 1000） */
export const MEMBER_NOTE_MAX = 1000;

/** 付款截圖：型別與大小（bucket 層另有 10MB / MIME 白名單，這裡是更嚴的第一道） */
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const PROOF_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const PROOF_EXT: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** 付款截圖私有桶：與後台／HYROX 共用 run-screenshots，不另建 bucket */
export const PROOF_BUCKET = "run-screenshots";

export const RACE_NOT_FOUND_MSG = "找不到這場賽事。";
export const REGISTRATION_NOT_FOUND_MSG = "找不到你的報名資料。";
export const CLOSED_EDIT_MSG = "報名已截止，如需修改請聯絡教練。";
export const CANCELLED_EDIT_MSG = "這筆報名已取消，如需恢復請聯絡教練。";

/* =============================================================
 * 登入者（每個 handler 的第一行）
 * ============================================================= */

export type MemberCtx = { supabase: SupabaseClient; user: User };
export type MemberAuth = { ok: true; ctx: MemberCtx } | { ok: false; res: Response };

/**
 * 取得目前登入會員；失敗時直接回對應 JSON（400 未設定／401 未登入）。
 * 不 throw，呼叫端只要 `if (!auth.ok) return auth.res;`。
 */
export async function requireMember(): Promise<MemberAuth> {
  if (!isSupabaseConfigured) return { ok: false, res: jsonNotConfigured() };

  const supabase = await createClient();
  if (!supabase) return { ok: false, res: jsonNotConfigured() };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, res: jsonUnauthenticated() };

  return { ok: true, ctx: { supabase, user } };
}

/* =============================================================
 * 賽事守門（會員端只認 series='race' 且對外可見的場次）
 * ============================================================= */

export type MemberRaceRow = {
  id: string;
  title: string;
  series: string | null;
  status: string;
  event_date: string;
  end_date: string | null;
  fee_cents: number | null;
  registration_deadline: string | null;
};

/**
 * 取賽事，並且只認 series='race'。
 *
 * 用會員自己的 client（帶 cookie）：events_select_race_public 只放行
 * status in (open, closed, photos)，所以 draft / archived 一律看不到 → 回 null → 404。
 * 這是刻意的：不對外存在的賽事，連「有沒有報名」都不該被探測。
 */
export async function loadMemberRace(
  supabase: SupabaseClient,
  eventId: string
): Promise<{ row: MemberRaceRow | null; error: unknown }> {
  const { data, error } = await supabase
    .from("events")
    .select("id,title,series,status,event_date,end_date,fee_cents,registration_deadline")
    .eq("id", eventId)
    .maybeSingle();

  if (error) return { row: null, error };

  const row = (data as unknown as MemberRaceRow | null) ?? null;
  if (!row || row.series !== "race") return { row: null, error: null };
  return { row, error: null };
}

/**
 * 是否還在收報名。
 * @returns null = 可報名；字串 = 應該回 409 的原因（可直接顯示給會員）
 *
 * 註：這裡是「先講清楚原因」的第一道；資料庫的 race_event_accepting() 是第二道
 * （時鐘差、並發截止時由 DB 擋，API 把 42501 也翻成同一句 409）。
 */
export function acceptingError(row: MemberRaceRow): string | null {
  if (row.status !== "open") return "這場賽事的報名已截止。";
  if (row.registration_deadline) {
    const t = Date.parse(row.registration_deadline);
    if (Number.isFinite(t) && Date.now() > t) {
      const shown = row.registration_deadline.slice(0, 16).replace("T", " ");
      return `報名已於 ${shown}（UTC）截止。`;
    }
  }
  return null;
}

/* =============================================================
 * 報名表解析（白名單；body 多餘的鍵一律忽略）
 * ============================================================= */

export type ParsedEntry = { category_id: string; teammate_names: string | null };

export type ParsedRegistration = {
  full_name: string;
  phone: string;
  gender: Gender;
  needs_bus: boolean;
  bus_seats: number;
  needs_lodging: boolean;
  lodging_people: number;
  lodging_nights: number;
  member_note: string | null;
  entries: ParsedEntry[];
};

export type ParseRegistrationResult =
  | { ok: true; value: ParsedRegistration }
  | { ok: false; fields: Record<string, string> };

/** 以 code point 計長，中文／emoji 不會被算成 2 個字 */
function cpLength(s: string): number {
  return Array.from(s).length;
}

/** 整數解析：只接受 number 或純數字字串，其餘回 NaN */
function toInt(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && /^-?\d+$/.test(raw.trim())) return Number(raw.trim());
  return Number.NaN;
}

/**
 * 解析並驗證報名表。只認白名單欄位，其餘（user_id / status / payment_status /
 * event_id / id …）一律忽略——不盲寫 body。
 *
 * 「布林關掉就強制 0」：needs_bus=false 時不管 body 送了什麼座位數，一律 0；
 * 反之 needs_bus=true 時座位數必填且 1–20。住宿同理。
 */
export function parseRegistrationBody(
  body: Record<string, unknown>
): ParseRegistrationResult {
  const fields: Record<string, string> = {};
  const value = {} as ParsedRegistration;

  /* --- full_name（2–60） --- */
  const rawName = body.full_name;
  if (typeof rawName !== "string" || rawName.trim() === "") {
    fields.full_name = "請填寫姓名。";
  } else if (cpLength(rawName.trim()) < FULL_NAME_MIN || cpLength(rawName.trim()) > FULL_NAME_MAX) {
    fields.full_name = `姓名需 ${FULL_NAME_MIN} 到 ${FULL_NAME_MAX} 個字。`;
  } else {
    value.full_name = rawName.trim();
  }

  /* --- phone（6–20，只含數字／+／-／空格） --- */
  const rawPhone = body.phone;
  if (typeof rawPhone !== "string" || rawPhone.trim() === "") {
    fields.phone = "請填寫聯絡電話。";
  } else {
    const phone = rawPhone.trim();
    if (phone.length < PHONE_MIN || phone.length > PHONE_MAX) {
      fields.phone = `電話需 ${PHONE_MIN} 到 ${PHONE_MAX} 個字元。`;
    } else if (!PHONE_RE.test(phone)) {
      fields.phone = "電話只能包含數字、+、- 與空格。";
    } else {
      value.phone = phone;
    }
  }

  /* --- gender（male / female） --- */
  const rawGender = body.gender;
  if (typeof rawGender !== "string" || !(GENDERS as readonly string[]).includes(rawGender)) {
    fields.gender = "請選擇性別（male／female）。";
  } else {
    value.gender = rawGender as Gender;
  }

  /* --- needs_bus / bus_seats --- */
  const rawBus = body.needs_bus;
  if (typeof rawBus !== "boolean") {
    fields.needs_bus = "是否需要巴士必須是 true 或 false。";
  } else if (!rawBus) {
    value.needs_bus = false;
    value.bus_seats = 0; // 關掉就是 0，不管 body 送什麼
  } else {
    value.needs_bus = true;
    const seats = toInt(body.bus_seats);
    if (!Number.isInteger(seats) || seats < BUS_SEATS_MIN || seats > BUS_SEATS_MAX) {
      fields.bus_seats = `需要巴士時，座位數必須介於 ${BUS_SEATS_MIN} 到 ${BUS_SEATS_MAX}。`;
    } else {
      value.bus_seats = seats;
    }
  }

  /* --- needs_lodging / lodging_people / lodging_nights --- */
  const rawLodging = body.needs_lodging;
  if (typeof rawLodging !== "boolean") {
    fields.needs_lodging = "是否需要住宿必須是 true 或 false。";
  } else if (!rawLodging) {
    value.needs_lodging = false;
    value.lodging_people = 0;
    value.lodging_nights = 0;
  } else {
    value.needs_lodging = true;
    const people = toInt(body.lodging_people);
    if (!Number.isInteger(people) || people < LODGING_PEOPLE_MIN || people > LODGING_PEOPLE_MAX) {
      fields.lodging_people = `需要住宿時，人數必須介於 ${LODGING_PEOPLE_MIN} 到 ${LODGING_PEOPLE_MAX}。`;
    } else {
      value.lodging_people = people;
    }
    const nights = toInt(body.lodging_nights);
    if (!Number.isInteger(nights) || nights < LODGING_NIGHTS_MIN || nights > LODGING_NIGHTS_MAX) {
      fields.lodging_nights = `需要住宿時，晚數必須介於 ${LODGING_NIGHTS_MIN} 到 ${LODGING_NIGHTS_MAX}。`;
    } else {
      value.lodging_nights = nights;
    }
  }

  /* --- member_note（可空，≤1000） --- */
  const rawNote = body.member_note;
  if (rawNote === undefined || rawNote === null || rawNote === "") {
    value.member_note = null;
  } else if (typeof rawNote !== "string") {
    fields.member_note = "備註格式錯誤。";
  } else if (cpLength(rawNote.trim()) > MEMBER_NOTE_MAX) {
    fields.member_note = `備註最多 ${MEMBER_NOTE_MAX} 個字。`;
  } else {
    value.member_note = rawNote.trim() === "" ? null : rawNote.trim();
  }

  /* --- entries（1–8，category_id 不得重複） --- */
  const rawEntries = body.entries;
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    fields.entries = "請至少選一個組別。";
  } else if (rawEntries.length < ENTRIES_MIN || rawEntries.length > ENTRIES_MAX) {
    fields.entries = `一次最多只能報 ${ENTRIES_MAX} 個組別。`;
  } else {
    const parsed: ParsedEntry[] = [];
    const seen = new Set<string>();
    let dup = false;
    let bad = false;

    for (const item of rawEntries) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        bad = true;
        break;
      }
      const row = item as Record<string, unknown>;
      if (!isUuid(row.category_id)) {
        bad = true;
        break;
      }
      const categoryId = String(row.category_id).trim();
      if (seen.has(categoryId)) {
        dup = true;
        break;
      }
      seen.add(categoryId);

      let teammate: string | null = null;
      const rawMate = row.teammate_names;
      if (rawMate !== undefined && rawMate !== null && rawMate !== "") {
        if (typeof rawMate !== "string") {
          bad = true;
          break;
        }
        if (cpLength(rawMate.trim()) > TEAMMATE_MAX) {
          fields.entries = `隊友名最多 ${TEAMMATE_MAX} 個字。`;
          bad = true;
          break;
        }
        teammate = rawMate.trim() === "" ? null : rawMate.trim();
      }

      parsed.push({ category_id: categoryId, teammate_names: teammate });
    }

    if (dup) {
      fields.entries = "同一個組別不可重複報名。";
    } else if (bad) {
      if (!fields.entries) fields.entries = "組別格式錯誤，請重新選擇。";
    } else {
      value.entries = parsed;
    }
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return { ok: true, value };
}

/* =============================================================
 * 組別歸屬驗證（必須屬於同一場賽事）+ 報名費判斷
 * ============================================================= */

export type CategoryRow = { id: string; fee_cents: number; event_id: string };

/**
 * 確認每一個 category_id 都屬於這場賽事。
 *
 * @returns ids 對應的組別列；有不存在／不屬於本場的 → error 訊息（給 400 fields.entries）
 *
 * 註：race_categories 的 select 政策要求賽事對外可見，所以呼叫前一定要先過
 * loadMemberRace（否則 RLS 會讓查詢「查到 0 筆」而誤判成組別不屬於本場）。
 */
export async function loadEventCategories(
  supabase: SupabaseClient,
  eventId: string,
  categoryIds: string[]
): Promise<{ rows: CategoryRow[]; error: string | null }> {
  const uniq = Array.from(new Set(categoryIds));
  const { data, error } = await supabase
    .from("race_categories")
    .select("id,event_id,fee_cents")
    .eq("event_id", eventId)
    .in("id", uniq)
    .limit(ENTRIES_MAX);

  if (error) return { rows: [], error: "無法確認組別資料，請稍後再試。" };

  const rows = (data as unknown as CategoryRow[] | null) ?? [];
  if (rows.length !== uniq.length) {
    return { rows: [], error: "有組別不屬於這場賽事，請重新選擇。" };
  }
  return { rows, error: null };
}

/**
 * 這筆報名要不要付款。
 * 全為 0 → not_required；有任何一個 > 0 → pending。
 * （賽事本身的 fee_cents 也算進去：場地費之類的統一收費不掛在組別上。）
 */
export function decidePaymentStatus(
  race: MemberRaceRow,
  categories: CategoryRow[]
): "not_required" | "pending" {
  const eventFee = Number(race.fee_cents ?? 0);
  const total = categories.reduce((sum, c) => sum + Number(c.fee_cents ?? 0), 0);
  return eventFee > 0 || total > 0 ? "pending" : "not_required";
}

/* =============================================================
 * 讀自己的報名（含 entries 與組別詳情）
 * ============================================================= */

export type RegistrationView = {
  id: string;
  event_id: string;
  user_id: string;
  full_name: string;
  phone: string;
  gender: Gender | null;
  needs_bus: boolean;
  bus_seats: number;
  needs_lodging: boolean;
  lodging_people: number;
  lodging_nights: number;
  payment_proof_path: string | null;
  payment_status: string;
  status: string;
  member_note: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
};

export type EntryView = {
  id: string;
  category_id: string;
  teammate_names: string | null;
  category: {
    id: string;
    name: string;
    day: string;
    team_size: number;
    fee_cents: number;
  } | null;
};

type RawRegistration = RegistrationView & {
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

/**
 * 取「本人在這場賽事的」報名。
 *
 * 兩個條件同時下（event_id + user_id）：RLS 已經只放行 user_id = auth.uid()，
 * 這裡再明示一次是第二道鎖（政策被改壞時也不會回別人的資料）。
 */
export async function readMyRegistration(
  supabase: SupabaseClient,
  eventId: string,
  userId: string
): Promise<{ registration: RegistrationView | null; entries: EntryView[]; error: unknown }> {
  const { data, error } = await supabase
    .from("race_registrations")
    .select(
      "id,event_id,user_id,full_name,phone,gender,needs_bus,bus_seats," +
        "needs_lodging,lodging_people,lodging_nights,payment_proof_path," +
        "payment_status,status,member_note,admin_note,created_at,updated_at," +
        "race_entries(id,category_id,teammate_names," +
        "race_categories(id,name,day,team_size,fee_cents))"
    )
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { registration: null, entries: [], error };

  const row = (data as unknown as RawRegistration | null) ?? null;
  if (!row) return { registration: null, entries: [], error: null };

  const entries: EntryView[] = (row.race_entries ?? []).map((e) => ({
    id: e.id,
    category_id: e.category_id,
    teammate_names: e.teammate_names ?? null,
    category: e.race_categories
      ? {
          id: e.race_categories.id,
          name: e.race_categories.name,
          day: e.race_categories.day,
          team_size: Number(e.race_categories.team_size ?? 1),
          fee_cents: Number(e.race_categories.fee_cents ?? 0),
        }
      : null,
  }));

  // 依日期、再依名稱排序，讓前端與後台看到的順序一致
  entries.sort((a, b) => {
    const da = a.category?.day ?? "";
    const db = b.category?.day ?? "";
    if (da !== db) return da < db ? -1 : 1;
    const na = a.category?.name ?? "";
    const nb = b.category?.name ?? "";
    return na < nb ? -1 : na > nb ? 1 : 0;
  });

  const registration: RegistrationView = {
    id: row.id,
    event_id: row.event_id,
    user_id: row.user_id,
    full_name: row.full_name,
    phone: row.phone,
    gender: (row.gender as Gender | null) ?? null,
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
  };

  return { registration, entries, error: null };
}

/* =============================================================
 * 付款截圖上載驗證
 * ============================================================= */

/** 檔頭魔術數字 → 實際型別（擋「.exe 改名成 .jpg」這種） */
export function sniffImageMime(head: Uint8Array): string | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return "image/png";
  }
  if (head.length >= 12) {
    const riff =
      head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46;
    const webp =
      head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
    if (riff && webp) return "image/webp";
  }
  return null;
}

/** 提示用：檔案太大時的統一訊息（5MB） */
export const PROOF_TOO_LARGE_MSG = "圖片不可超過 5MB，請壓縮後再上載。";
export const PROOF_BAD_TYPE_MSG = "只接受 JPG／PNG／WebP 圖片。";

/**
 * 付款截圖的物件路徑。
 *
 * 【為什麼第一層一定是 user.id】
 * run-screenshots 的 insert 政策 runshots_insert_own（supabase/schema.sql:866-872）
 * 是 `(storage.foldername(name))[1] = auth.uid()::text`，
 * 也就是「第一層資料夾必須是自己的 uid」。原本設計的
 * `races/{eventId}/{userId}/{ts}.{ext}` 第一層是 races → 100% 被 RLS 擋下（42501），
 * 而本站沒有 service_role key 可以繞過、也不該為此另建 bucket。
 * 因此改成 uid 在最前面、`races/{eventId}` 往後挪一層：
 *     `{userId}/races/{eventId}/{timestamp}.{ext}`
 * 仍是「一個會員一個資料夾、路徑由伺服器組、client 不能指定」，
 * 也符合 race_registrations.payment_proof_path 的 check（≤500、無 .. 、不以 / 開頭）。
 */
export function buildProofPath(userId: string, eventId: string, ext: string): string {
  return `${userId}/races/${eventId}/${Date.now()}.${ext}`;
}

/** Storage 錯誤 → 給會員看的訊息（不含 storage 原文） */
export function proofUploadFailed() {
  return jsonErr("圖片上載失敗，請稍後再試。", "STORAGE", 502);
}
