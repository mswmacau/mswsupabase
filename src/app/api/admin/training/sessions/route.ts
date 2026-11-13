/**
 * GET  /api/admin/training/sessions?year=&month= — 該月全部場次（含 cancelled）
 * POST /api/admin/training/sessions               — { action: 'create' | 'update' | 'delete' | 'copy' }
 *
 * 【與 legacy /api/admin/sessions 的關係】
 * 那支路由是 /admin/sessions 頁的舊入口，本次**刻意不動**（不刪、不改行為）。
 * 本檔是「按月管理」新頁面用的入口，語義差別：
 *   · legacy 以「日期」為中心、只認一個可選的 class_id；
 *     本檔以「課程 + 日期 + 時段」為中心，class_id / start_time / end_time 都是必填。
 *   · legacy 不處理刪除；本檔的 delete 會先檢查簽到紀錄再刪。
 *
 * 【為什麼刪除要先查 training_checkins】
 * supabase/schema.sql:117 的 training_checkins.session_id 是 `on delete cascade`。
 * 直接 delete 場次會**靜默連簽到紀錄一起刪掉**（會員的訓練紀錄消失，無法復原）。
 * 因此：有簽到 → 409 HAS_CHECKINS，請改用 status='cancelled' 取消。
 *
 * 【時區】
 * starts_at / ends_at 是 timestamptz。澳門無夏令時間（固定 UTC+8），
 * 所以「澳門牆上時間」＝帶 +08:00 偏移的 ISO 字串（_shared.ts 的 macauTimestamp）。
 * 若寫成無偏移字串，PostgREST 會用 DB session 時區（UTC）解析，整整差 8 小時。
 *
 * 權限：authorizeAdmin()（未設定 400 / 未登入 401 / 非管理員 403）
 * Owner：白客（backend-engineer）
 */

import { writeAuditLog } from "@/lib/audit";
import { trainingMonthRange } from "@/lib/queries";
import {
  jsonBadJson,
  jsonForbidden,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";
import {
  authorizeAdmin,
  isForeignKeyViolation,
  isIntInRange,
  isValidDate,
  isUniqueViolation,
  jsonTrainingConflict,
  jsonTrainingDbError,
  macauTimestamp,
  normalizeTime,
  revalidateTrainingSchedule,
  requireUuid,
  text,
  type Supabase,
} from "../_shared";

const MIGRATION = "supabase/migration-training-months.sql";

const LIMITS = { location: 120, coachName: 60, note: 500 } as const;
const STATUSES = ["open", "closed", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

/** session_date 的允許範圍（training_months 的 year check 也是 2024–2100） */
const MIN_DATE = "2024-01-01";
const MAX_DATE = "2100-12-31";
const DEFAULT_LOCATION = "澳門街健館";
const DEFAULT_CAPACITY = 30;

/** 月曆場次的查詢欄位（課程以別名 class 內嵌） */
const SESSION_SELECT =
  "id, session_date, start_time, end_time, class_id, title, location, location_override, " +
  "coach_name, capacity, status, note, class:training_classes(id, name, category, color_key)";

type ClassRef = {
  id: string;
  name: string;
  category: string | null;
  color_key: string | null;
};

type SessionRowDb = {
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
  status: Status;
  note: string | null;
  class: ClassRef | null;
};

/** 課程的預設值（新增場次時用來補 title / location / coach_name / capacity） */
type ClassDefaults = {
  id: string;
  name: string;
  location: string | null;
  coach_name: string | null;
  capacity: number | null;
};

/* =============================================================
 * 小工具
 * ============================================================= */

/** 讀名額：未提供回 fallback；提供了必須是 1–999 的整數，非法回 null */
function readCapacity(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 999) return null;
  return n;
}

/** 讀狀態：未提供回 fallback；提供了必須是合法列舉，非法回 null */
function readStatus(value: unknown, fallback: Status): Status | null {
  if (value === undefined || value === null || text(value) === "") return fallback;
  const raw = text(value);
  if (!(STATUSES as readonly string[]).includes(raw)) return null;
  return raw as Status;
}

/** 字串長度檢查；超長回 { field: 訊息 }，否則 null */
function tooLong(
  value: string,
  limit: number,
  field: string,
  label: string
): Record<string, string> | null {
  return value.length <= limit ? null : { [field]: `${label}過長（上限 ${limit} 字）。` };
}

/** 取課程預設值；不存在回 null */
async function loadClassDefaults(
  supabase: Supabase,
  classId: string
): Promise<{ data: ClassDefaults | null; error: unknown }> {
  const { data, error } = await supabase
    .from("training_classes")
    .select("id, name, location, coach_name, capacity")
    .eq("id", classId)
    .maybeSingle();

  if (error) return { data: null, error };
  return { data: (data as ClassDefaults | null) ?? null, error: null };
}

/* =============================================================
 * GET — 該月全部場次（含 cancelled）
 * ============================================================= */

export async function GET(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year"));
    const month = Number(url.searchParams.get("month"));

    // 0 / -1 / 99999 / "abc" / 缺參數 全部到這裡被擋掉
    if (!isIntInRange(year, 2024, 2100)) {
      return jsonValidation({ year: "年份需介於 2024 與 2100 之間。" }, "請選擇正確的年月。");
    }
    if (!isIntInRange(month, 1, 12)) {
      return jsonValidation({ month: "月份需介於 1 與 12 之間。" }, "請選擇正確的年月。");
    }

    const range = trainingMonthRange(year, month);
    if (!range) {
      return jsonValidation({}, "年月不合法。");
    }

    const { data, error } = await supabase
      .from("training_sessions")
      .select(SESSION_SELECT)
      .gte("session_date", range.from)
      .lte("session_date", range.to)
      .order("session_date", { ascending: true })
      .order("start_time", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true });

    if (error) {
      return jsonTrainingDbError("GET /api/admin/training/sessions", error, MIGRATION);
    }

    const sessions = ((data ?? []) as unknown as SessionRowDb[]).map((row) => ({
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
      class_category: row.class?.category ?? null,
      class_color_key: row.class?.color_key ?? null,
    }));

    return jsonOk({ year, month, sessions, count: sessions.length });
  } catch (err) {
    return jsonInternal("GET /api/admin/training/sessions", err);
  }
}

/* =============================================================
 * POST — create / update / delete / copy
 * ============================================================= */

export async function POST(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if ("res" in auth) return auth.res;
    const { supabase, userId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const action = text(body.action);
    if (action === "create") return createSession(supabase, userId, body);
    if (action === "update") return updateSession(supabase, userId, body);
    if (action === "delete") return deleteSession(supabase, userId, body);
    if (action === "copy") return copyMonth(supabase, userId, body);

    return jsonValidation(
      { action: "不支援的操作。" },
      "不支援的操作，action 必須是 create、update、delete 或 copy。"
    );
  } catch (err) {
    return jsonInternal("POST /api/admin/training/sessions", err);
  }
}

/* -------------------------------------------------------------
 * create
 * ----------------------------------------------------------- */

async function createSession(
  supabase: Supabase,
  userId: string,
  body: Record<string, unknown>
): Promise<Response> {
  /* 1. 日期 */
  const sessionDate = text(body.session_date);
  if (!isValidDate(sessionDate) || sessionDate < MIN_DATE || sessionDate > MAX_DATE) {
    return jsonValidation(
      { session_date: "請選擇 2024-01-01 之後的正確日期。" },
      "請檢查表單內容。"
    );
  }

  /* 2. 課程 */
  const classId = requireUuid(body.class_id);
  if (!classId) {
    return jsonValidation({ class_id: "課程編號格式錯誤。" }, "請檢查表單內容。");
  }

  /* 3. 時段 */
  const start = normalizeTime(body.start_time);
  if (!start) {
    return jsonValidation({ start_time: "時間格式需為 HH:MM。" }, "請檢查表單內容。");
  }
  const end = normalizeTime(body.end_time);
  if (!end) {
    return jsonValidation({ end_time: "時間格式需為 HH:MM。" }, "請檢查表單內容。");
  }
  // 皆為零填充的 HH:MM:SS，字串比較等同時間比較
  if (end <= start) {
    return jsonValidation({ end_time: "結束時間需晚於開始時間。" }, "請檢查表單內容。");
  }

  /* 4. 狀態 */
  const status = readStatus(body.status, "open");
  if (!status) {
    return jsonValidation({ status: "狀態必須是開放、截止或取消。" }, "請檢查表單內容。");
  }

  /* 5. 名額（先驗格式，課程載入後再補預設） */
  const providedCapacity = readCapacity(body.capacity, DEFAULT_CAPACITY);
  if (providedCapacity === null) {
    return jsonValidation({ capacity: "名額需介於 1 與 999 之間。" }, "請檢查表單內容。");
  }

  /* 6. 文字長度 */
  const providedLocation = text(body.location);
  const coachName = text(body.coach_name);
  const note = text(body.note);

  const badLocation = tooLong(providedLocation, LIMITS.location, "location", "場地名稱");
  if (badLocation) return jsonValidation(badLocation, "請檢查表單內容。");
  const badCoach = tooLong(coachName, LIMITS.coachName, "coach_name", "教練名稱");
  if (badCoach) return jsonValidation(badCoach, "請檢查表單內容。");
  const badNote = tooLong(note, LIMITS.note, "note", "備註");
  if (badNote) return jsonValidation(badNote, "請檢查表單內容。");

  /* 7. 課程必須存在（不依賴 FK 錯誤，文案才可控） */
  const { data: klass, error: classError } = await loadClassDefaults(supabase, classId);
  if (classError) {
    return jsonTrainingDbError("POST /api/admin/training/sessions class", classError, MIGRATION);
  }
  if (!klass) {
    return jsonValidation({ class_id: "找不到這門課程。" }, "請檢查表單內容。");
  }

  const capacity =
    body.capacity === undefined || body.capacity === null || body.capacity === ""
      ? (klass.capacity ?? DEFAULT_CAPACITY)
      : providedCapacity;

  /* 8. 寫入
   * title 不在 body 裡：training_sessions.title 是 not null，
   * 值一律由課程名稱帶入（客戶要的「新增出來和 11 月樣式一樣」）。
   * location_override 只在管理員明確指定場地時才有值，
   * 讓前台能區分「課程預設場地」與「這一場特別改過場地」。 */
  const payload: Record<string, unknown> = {
    session_date: sessionDate,
    class_id: classId,
    start_time: start,
    end_time: end,
    starts_at: macauTimestamp(sessionDate, start),
    ends_at: macauTimestamp(sessionDate, end),
    title: klass.name,
    location: providedLocation || klass.location || DEFAULT_LOCATION,
    location_override: providedLocation || null,
    coach_name: coachName || klass.coach_name || null,
    capacity,
    note: note || null,
    status,
  };

  const { data, error } = await supabase
    .from("training_sessions")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) {
      return jsonTrainingConflict(
        "DUPLICATE",
        "同一課程在同一天同一時段已經有場次了。請改時段，或先編輯既有的那一場。"
      );
    }
    if (isForeignKeyViolation(error)) {
      return jsonValidation({ class_id: "找不到這門課程。" }, "請檢查表單內容。");
    }
    return jsonTrainingDbError("POST /api/admin/training/sessions insert", error, MIGRATION);
  }

  revalidateTrainingSchedule();
  await writeAuditLog(
    supabase,
    userId,
    "training",
    "create",
    `新增 ${sessionDate} ${klass.name} ${start.slice(0, 5)}-${end.slice(0, 5)} 班表場次`
  );

  return jsonOk({
    message: `已新增 ${sessionDate} ${klass.name} ${start.slice(0, 5)}-${end.slice(0, 5)} 的場次。`,
    id: (data as { id: string } | null)?.id ?? null,
  });
}

/* -------------------------------------------------------------
 * update
 * ----------------------------------------------------------- */

async function updateSession(
  supabase: Supabase,
  userId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const id = requireUuid(body.id);
  if (!id) {
    return jsonValidation({ id: "缺少有效的場次編號。" }, "請檢查表單內容。");
  }

  const { data: existingData, error: readError } = await supabase
    .from("training_sessions")
    .select(
      "id, session_date, class_id, start_time, end_time, capacity, note, status, title, location, location_override, coach_name"
    )
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    return jsonTrainingDbError("POST /api/admin/training/sessions read", readError, MIGRATION);
  }
  const existing = existingData as {
    id: string;
    session_date: string;
    class_id: string | null;
    start_time: string | null;
    end_time: string | null;
    capacity: number;
    note: string | null;
    status: Status;
    title: string;
    location: string;
    location_override: string | null;
    coach_name: string | null;
  } | null;

  if (!existing) return jsonNotFound("找不到這筆訓練場次。");

  /* ---------- 日期 ---------- */
  let sessionDate = existing.session_date;
  if (body.session_date !== undefined) {
    sessionDate = text(body.session_date);
    if (!isValidDate(sessionDate) || sessionDate < MIN_DATE || sessionDate > MAX_DATE) {
      return jsonValidation(
        { session_date: "請選擇 2024-01-01 之後的正確日期。" },
        "請檢查表單內容。"
      );
    }
  }

  /* ---------- 課程（有改才重讀） ---------- */
  let classId = existing.class_id;
  let klass: ClassDefaults | null = null;
  const classChanged = body.class_id !== undefined && text(body.class_id) !== "";
  if (classChanged) {
    const nextClassId = requireUuid(body.class_id);
    if (!nextClassId) {
      return jsonValidation({ class_id: "課程編號格式錯誤。" }, "請檢查表單內容。");
    }
    const loaded = await loadClassDefaults(supabase, nextClassId);
    if (loaded.error) {
      return jsonTrainingDbError(
        "POST /api/admin/training/sessions class",
        loaded.error,
        MIGRATION
      );
    }
    if (!loaded.data) {
      return jsonValidation({ class_id: "找不到這門課程。" }, "請檢查表單內容。");
    }
    classId = nextClassId;
    klass = loaded.data;
  }

  /* ---------- 時段 ----------
   * 沒給就沿用現值。**不從 starts_at 反推**：
   * 舊資料的 starts_at 可能是無偏移字串存下的（實際差 8 小時），
   * 反推會把錯的時間固化成「正確值」。 */
  let start = existing.start_time;
  if (body.start_time !== undefined && text(body.start_time) !== "") {
    const parsed = normalizeTime(body.start_time);
    if (!parsed) {
      return jsonValidation({ start_time: "時間格式需為 HH:MM。" }, "請檢查表單內容。");
    }
    start = parsed;
  }

  let end = existing.end_time;
  if (body.end_time !== undefined && text(body.end_time) !== "") {
    const parsed = normalizeTime(body.end_time);
    if (!parsed) {
      return jsonValidation({ end_time: "時間格式需為 HH:MM。" }, "請檢查表單內容。");
    }
    end = parsed;
  }

  if ((start === null) !== (end === null)) {
    return jsonValidation(
      { start_time: "請同時提供開始與結束時間。" },
      "請檢查表單內容。"
    );
  }
  if (start !== null && end !== null && end <= start) {
    return jsonValidation({ end_time: "結束時間需晚於開始時間。" }, "請檢查表單內容。");
  }
  if (start === null && sessionDate !== existing.session_date) {
    return jsonValidation(
      { start_time: "改動日期時必須同時提供開始與結束時間。" },
      "請檢查表單內容。"
    );
  }

  /* ---------- 名額 ---------- */
  let capacity = existing.capacity;
  if (body.capacity !== undefined && body.capacity !== null && body.capacity !== "") {
    const parsed = readCapacity(body.capacity, existing.capacity);
    if (parsed === null) {
      return jsonValidation({ capacity: "名額需介於 1 與 999 之間。" }, "請檢查表單內容。");
    }
    capacity = parsed;
  }

  /* ---------- 狀態（未提供就沿用，避免把 cancelled 復活成 open） ---------- */
  const status = readStatus(body.status, existing.status);
  if (!status) {
    return jsonValidation({ status: "狀態必須是開放、截止或取消。" }, "請檢查表單內容。");
  }

  /* ---------- 文字欄位 ---------- */
  const note = body.note === undefined ? existing.note : text(body.note) || null;

  let location = existing.location;
  let locationOverride = existing.location_override;
  if (body.location !== undefined) {
    location = text(body.location) || existing.location;
    locationOverride = text(body.location) || null;
  } else if (classChanged && klass?.location) {
    location = klass.location;
    locationOverride = null;
  }

  let coachName = existing.coach_name;
  if (body.coach_name !== undefined) {
    coachName = text(body.coach_name) || null;
  } else if (classChanged) {
    coachName = klass?.coach_name ?? existing.coach_name;
  }

  const title = classChanged && klass ? klass.name : existing.title;

  const badLocation = tooLong(location, LIMITS.location, "location", "場地名稱");
  if (badLocation) return jsonValidation(badLocation, "請檢查表單內容。");
  const badCoach = coachName
    ? tooLong(coachName, LIMITS.coachName, "coach_name", "教練名稱")
    : null;
  if (badCoach) return jsonValidation(badCoach, "請檢查表單內容。");
  const badNote = note ? tooLong(note, LIMITS.note, "note", "備註") : null;
  if (badNote) return jsonValidation(badNote, "請檢查表單內容。");

  const payload: Record<string, unknown> = {
    session_date: sessionDate,
    class_id: classId,
    capacity,
    note,
    status,
    title,
    location,
    location_override: locationOverride,
    coach_name: coachName,
  };

  if (start !== null && end !== null) {
    payload.start_time = start;
    payload.end_time = end;
    payload.starts_at = macauTimestamp(sessionDate, start);
    payload.ends_at = macauTimestamp(sessionDate, end);
  }

  const { data, error } = await supabase
    .from("training_sessions")
    .update(payload)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) {
      return jsonTrainingConflict(
        "DUPLICATE",
        "同一課程在同一天同一時段已經有場次了。請改時段。"
      );
    }
    if (isForeignKeyViolation(error)) {
      return jsonValidation({ class_id: "找不到這門課程。" }, "請檢查表單內容。");
    }
    return jsonTrainingDbError("POST /api/admin/training/sessions update", error, MIGRATION);
  }
  if (!data) return jsonNotFound("找不到這筆訓練場次。");

  revalidateTrainingSchedule();
  await writeAuditLog(
    supabase,
    userId,
    "training",
    "update",
    `更新 ${sessionDate} ${title} 的班表場次${status === "cancelled" ? "（已取消）" : ""}`
  );

  return jsonOk({ message: `已更新 ${sessionDate} ${title} 的場次。`, id });
}

/* -------------------------------------------------------------
 * delete
 * ----------------------------------------------------------- */

async function deleteSession(
  supabase: Supabase,
  userId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const id = requireUuid(body.id);
  if (!id) {
    return jsonValidation({ id: "缺少有效的場次編號。" }, "請檢查表單內容。");
  }

  const { data: existing, error: readError } = await supabase
    .from("training_sessions")
    .select("id, session_date, title, status")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    return jsonTrainingDbError("POST /api/admin/training/sessions read", readError, MIGRATION);
  }
  if (!existing) return jsonNotFound("找不到這筆訓練場次。");

  /* 先擋簽到紀錄：training_checkins.session_id 是 on delete cascade，
   * 不擋就會連會員的簽到紀錄一起刪掉（無法復原）。 */
  const { count, error: countError } = await supabase
    .from("training_checkins")
    .select("id", { count: "exact", head: true })
    .eq("session_id", id);

  if (countError) {
    return jsonTrainingDbError(
      "POST /api/admin/training/sessions checkins",
      countError,
      MIGRATION
    );
  }
  if ((count ?? 0) > 0) {
    return jsonTrainingConflict(
      "HAS_CHECKINS",
      `這筆場次已有 ${count} 筆會員簽到紀錄，無法刪除。請改為「取消」（狀態改為 cancelled），紀錄才會保留。`
    );
  }

  const { data: deleted, error: deleteError } = await supabase
    .from("training_sessions")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (deleteError) {
    return jsonTrainingDbError("POST /api/admin/training/sessions delete", deleteError, MIGRATION);
  }
  if (!deleted) return jsonNotFound("找不到這筆訓練場次。");

  const row = existing as { session_date: string; title: string };

  revalidateTrainingSchedule();
  await writeAuditLog(
    supabase,
    userId,
    "training",
    "delete",
    `刪除 ${row.session_date} ${row.title} 的班表場次`
  );

  return jsonOk({ message: `已刪除 ${row.session_date} ${row.title} 的場次。`, id });
}

/* -------------------------------------------------------------
 * copy — 呼叫 copy_month_sessions RPC
 * ----------------------------------------------------------- */

async function copyMonth(
  supabase: Supabase,
  userId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const fromYear = Number(body.from_year);
  const fromMonth = Number(body.from_month);
  const toYear = Number(body.to_year);
  const toMonth = Number(body.to_month);

  if (!isIntInRange(fromYear, 2024, 2100) || !isIntInRange(toYear, 2024, 2100)) {
    return jsonValidation({ from_year: "年份需介於 2024 與 2100 之間。" }, "請選擇正確的年月。");
  }
  if (!isIntInRange(fromMonth, 1, 12) || !isIntInRange(toMonth, 1, 12)) {
    return jsonValidation({ from_month: "月份需介於 1 與 12 之間。" }, "請選擇正確的年月。");
  }

  const { data, error } = await supabase.rpc("copy_month_sessions", {
    p_from_year: fromYear,
    p_from_month: fromMonth,
    p_to_year: toYear,
    p_to_month: toMonth,
  });

  if (error) {
    return jsonTrainingDbError("POST /api/admin/training/sessions copy", error, MIGRATION);
  }

  const result =
    typeof data === "object" && data !== null
      ? (data as {
          ok?: boolean;
          code?: string;
          message?: string;
          created?: number;
          skipped?: number;
          conflicts?: number;
          from?: string;
          to?: string;
        })
      : {};

  if (result.ok !== true) {
    const code = text(result.code);
    if (code === "NOT_ADMIN") return jsonForbidden();
    if (code === "INVALID_ARGS" || code === "INVALID_RANGE") {
      return jsonValidation({}, text(result.message) || "參數不合法。");
    }
    return jsonInternal("POST /api/admin/training/sessions copy 未預期結果", result);
  }

  const created = typeof result.created === "number" ? result.created : 0;
  const skipped = typeof result.skipped === "number" ? result.skipped : 0;
  const conflicts = typeof result.conflicts === "number" ? result.conflicts : 0;

  revalidateTrainingSchedule();
  await writeAuditLog(
    supabase,
    userId,
    "training",
    "copy",
    `從 ${fromYear} 年 ${fromMonth} 月複製班表到 ${toYear} 年 ${toMonth} 月：新增 ${created} 場、目標月沒有該日期 ${skipped} 場、已存在而略過 ${conflicts} 場`
  );

  /* 三種「沒新增」的原因要分開講，否則客戶重複按一次會看到「新增 0 場」而以為壞了 */
  const reasons: string[] = [];
  if (skipped > 0) reasons.push(`${skipped} 場因目標月沒有該日期（例如 31 日）而略過`);
  if (conflicts > 0) reasons.push(`${conflicts} 場因目標月已有相同課程與時段而略過`);
  const tail = reasons.length > 0 ? `；${reasons.join("、")}` : "";

  return jsonOk({
    message: `已從 ${fromYear} 年 ${fromMonth} 月複製到 ${toYear} 年 ${toMonth} 月：新增 ${created} 場${tail}。`,
    created,
    skipped,
    conflicts,
    from: result.from ?? `${fromYear}-${String(fromMonth).padStart(2, "0")}`,
    to: result.to ?? `${toYear}-${String(toMonth).padStart(2, "0")}`,
  });
}

/* =============================================================
 * 未實作的 HTTP 方法一律回 JSON（H6）
 * ============================================================= */

export async function PUT() {
  return jsonMethodNotAllowed();
}

export async function PATCH() {
  return jsonMethodNotAllowed();
}

export async function DELETE() {
  return jsonMethodNotAllowed();
}
