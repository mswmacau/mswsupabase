import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isUuid,
  jsonBadJson,
  jsonConflict,
  jsonDbError,
  jsonErr,
  jsonForbidden,
  jsonMethodNotAllowed,
  jsonNotConfigured,
  jsonNotFound,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";

/**
 * 後台訓練場次寫入（/admin/sessions 頁的「建立場次」＋新班表資料模型共用）
 *
 * 【為什麼不再用 upsert + onConflict: "session_date"】
 * supabase/migration-training-schedule.sql:115-173（commit 2614314）依客戶硬需求
 * （同一時段可有多堂、不同場地／教練）做了三件事：
 *   1. 新增 class_id / start_time / end_time / coach_name / location_override
 *   2. drop constraint if exists training_sessions_session_date_key
 *   3. 改立部分唯一索引 uq_sessions_class_date_time
 *      on (class_id, session_date, start_time) where class_id is not null
 * 舊寫法 `.upsert(payload, { onConflict: "session_date" })` 依賴「一日一場」的單欄唯一約束，
 * 客戶一跑完 migration 就會拿到 Postgres 42P10
 * （no unique or exclusion constraint matching the ON CONFLICT specification）＝一存檔就失敗。
 *
 * 因此本檔的寫入語意改成：
 *   · 帶 id（或 action=update）→ UPDATE ... WHERE id = $1（不再靠日期當唯一鍵）
 *   · 不帶 id             → INSERT；唯一鍵衝突由我們自己對映成 409
 * 全檔「不得」再出現 upsert / onConflict，42P10 就沒有產生條件。
 *
 * 【時區】
 * starts_at / ends_at 是 timestamptz（supabase/schema.sql:104-105）。
 * 呼叫端只給「日期＋時間」字串時，必須自帶 +08:00 偏移；這是
 * generate_sessions RPC 裡 `(v_date + v_rule.start_time) at time zone 'Asia/Macau'`
 * 的等效寫法（Asia/Macau 無夏令時間，固定 UTC+8）。
 * 若像舊版寫成 `2026-03-02T20:00:00`（無偏移），PostgREST 會用 DB session 時區（UTC）
 * 解析，20:00 會被存成 20:00 UTC，以澳門時間呈現變成隔日 04:00 —— 也就是原本的 8 小時偏移 bug。
 *
 * 【向後相容】
 * 欄位名稱（session_date / start_time / end_time / title / location / note / capacity）
 * 與回應結構（{ ok, message }）不變；只在成功回應多帶一個 id（附加欄位）。
 * 沒帶 class_id 的舊呼叫端不會觸碰 migration 新增的欄位，因此在
 * 「已跑 migration」與「尚未跑 migration」兩種 DB 上都不會出現 42703 / 42P10。
 *
 * Owner：白客（backend-engineer）
 */

type Supabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** HH:MM 或 HH:MM:SS */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
/**
 * Asia/Macau 固定 UTC+8（無夏令時間），
 * 故「澳門牆上時間」＝帶 +08:00 偏移的 ISO 字串，
 * 與 SQL 的 `(session_date + start_time) at time zone 'Asia/Macau'` 結果一致。
 */
const MACAU_OFFSET = "+08:00";
const LIMITS = { title: 60, location: 120, note: 500, coachName: 60 } as const;
const STATUSES = ["open", "closed", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

/** 安全取字串 */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 'HH:MM' → 'HH:MM:SS'；格式不合回 null */
function normalizeTime(value: unknown): string | null {
  const raw = text(value);
  if (!TIME_RE.test(raw)) return null;
  return raw.length === 5 ? `${raw}:00` : raw;
}

/** 日期字串是否真實存在（擋 2026-02-31） */
function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * 「澳門日期＋時間」→ timestamptz。
 * 一定要帶 MACAU_OFFSET，理由見檔頭「時區」段。
 */
function macauTimestamp(date: string, time: string): string {
  return `${date}T${time}${MACAU_OFFSET}`;
}

/**
 * 既有 timestamptz → 澳門牆上時間 'HH:MM'。
 * 只用在「更新時呼叫端沒給時間」的沿用情境；解析失敗回 fallback。
 */
function macauTimeOf(value: unknown, fallback: string): string {
  const raw = text(value);
  if (!raw) return fallback;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return fallback;
  const hm = d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Macau",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return TIME_RE.test(hm) ? `${hm}:00` : fallback;
}

/** 取 Postgres / PostgREST 錯誤碼 */
function pgCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

function pgMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

/** migration 新增欄位不存在（客戶尚未執行 migration） */
function isColumnMissing(error: unknown): boolean {
  const code = pgCode(error);
  if (code === "42703" || code === "PGRST204") return true;
  return /column .* does not exist/i.test(pgMessage(error));
}

/**
 * 寫入錯誤的統一對映（錯誤文案不含 SQL、欄位名堆疊或路徑）：
 * - 23505 唯一鍵衝突 → 409。classBound 時是新索引 (class_id, session_date, start_time)；
 *   否則代表客戶的 DB 還在「一日一場」的舊約束。
 * - 23503 外鍵 → 400（class_id 指向不存在的課程）
 * - 42703 / PGRST204 且 classBound → 500 SCHEMA_OUTDATED（class_id 是 migration 產物）
 * - 其餘 → jsonDbError（P0001→404、22P02→400、其他→500 並寫 server log）
 */
function mapWriteError(where: string, error: unknown, classBound: boolean): Response {
  if (pgCode(error) === "23505") {
    return classBound
      ? jsonConflict("同一課程在同一時段已有場次。")
      : jsonConflict(
          "該日期已有場次。資料庫目前仍是一日一場的舊限制，請改為更新既有場次，或先執行 supabase/migration-training-schedule.sql。"
        );
  }
  if (pgCode(error) === "23503") {
    return jsonValidation({ class_id: "找不到這門課程。" }, "請檢查表單內容。");
  }
  if (classBound && isColumnMissing(error)) {
    return jsonErr(
      "訓練班表欄位尚未建立，請先執行 supabase/migration-training-schedule.sql。",
      "SCHEMA_OUTDATED",
      500
    );
  }
  return jsonDbError(where, error);
}

/** 權限：未設定 400 → 未登入 401 → 非管理員 403 */
async function requireAdmin(): Promise<{ supabase: Supabase } | { res: Response }> {
  if (!isSupabaseConfigured) return { res: jsonNotConfigured() };

  const supabase = await createClient();
  if (!supabase) return { res: jsonErr("客戶端初始化失敗。", "INTERNAL", 500) };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { res: jsonUnauthenticated() };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { res: jsonForbidden() };

  return { supabase };
}

/** capacity：未提供／空字串／null → 30；否則必須是 1–999 的有限數字 */
function readCapacity(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 30;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 999) return null;
  return Math.trunc(n);
}

/** 字串欄位長度檢查；超過回錯誤欄位物件，否則 null */
function tooLong(
  value: string,
  limit: number,
  field: string,
  label: string
): Record<string, string> | null {
  if (value.length <= limit) return null;
  return { [field]: `${label}過長（上限 ${limit} 字）。` };
}

/**
 * POST /api/admin/sessions
 *   body: { id?, action?: 'update', session_date, start_time?, end_time?, title?,
 *           location?, note?, capacity?, class_id?, coach_name?, location_override? }
 *   · 帶 id 或 action='update' → 以 id 更新
 *   · 否則 → 建立（帶 class_id 才是新班表語意）
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const action = text(body.action);
    const idRaw = body.id;
    const hasId = idRaw !== undefined && idRaw !== null && text(idRaw) !== "";

    if (hasId && !isUuid(idRaw)) {
      return jsonValidation({ id: "編號格式錯誤。" }, "請檢查表單內容。");
    }
    const id = hasId ? text(idRaw) : null;

    if (action === "update" && !id) {
      return jsonValidation({ id: "缺少有效的場次 id。" }, "請檢查表單內容。");
    }

    if (action !== "" && action !== "update" && action !== "create") {
      return jsonValidation({}, "不支援的操作，action 必須是 create 或 update。");
    }

    if (id || action === "update") {
      return updateSession(supabase, id as string, body);
    }
    return createSession(supabase, body);
  } catch (err) {
    return jsonDbError("POST /api/admin/sessions", err);
  }
}

/** PATCH /api/admin/sessions — 以 id 更新（body 需帶 id） */
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const id = isUuid(body.id) ? text(body.id) : null;
    if (!id) return jsonValidation({ id: "缺少有效的場次 id。" }, "請檢查表單內容。");

    return updateSession(supabase, id, body);
  } catch (err) {
    return jsonDbError("PATCH /api/admin/sessions", err);
  }
}

/** 建立：一律 insert，唯一鍵衝突自己對映成 409 */
async function createSession(supabase: Supabase, body: Record<string, unknown>): Promise<Response> {
  const sessionDate = text(body.session_date);
  if (!isValidDate(sessionDate)) {
    return jsonValidation({ session_date: "請選擇正確的日期。" }, "請選擇正確的日期。");
  }

  // 時間：未提供用預設；提供了就必須合法
  let start = "20:00:00";
  if (body.start_time !== undefined && text(body.start_time) !== "") {
    const parsed = normalizeTime(body.start_time);
    if (!parsed) return jsonValidation({ start_time: "時間格式需為 HH:MM。" }, "請檢查表單內容。");
    start = parsed;
  }

  let end = "21:00:00";
  if (body.end_time !== undefined && text(body.end_time) !== "") {
    const parsed = normalizeTime(body.end_time);
    if (!parsed) return jsonValidation({ end_time: "時間格式需為 HH:MM。" }, "請檢查表單內容。");
    end = parsed;
  }

  if (end <= start) {
    return jsonValidation({ end_time: "結束時間需晚於開始時間。" }, "請檢查表單內容。");
  }

  const capacity = readCapacity(body.capacity);
  if (capacity === null) {
    return jsonValidation({ capacity: "名額需介於 1 與 999 之間。" }, "請檢查表單內容。");
  }

  const title = text(body.title) || "MSW 定期訓練";
  const location = text(body.location) || "澳門街健館";
  const note = text(body.note);
  const coachName = text(body.coach_name);

  const badTitle = tooLong(title, LIMITS.title, "title", "場次名稱");
  if (badTitle) return jsonValidation(badTitle, "請檢查表單內容。");
  const badLocation = tooLong(location, LIMITS.location, "location", "場地名稱");
  if (badLocation) return jsonValidation(badLocation, "請檢查表單內容。");
  const badNote = tooLong(note, LIMITS.note, "note", "備註");
  if (badNote) return jsonValidation(badNote, "請檢查表單內容。");
  const badCoach = tooLong(coachName, LIMITS.coachName, "coach_name", "教練名稱");
  if (badCoach) return jsonValidation(badCoach, "請檢查表單內容。");

  // 新班表語意：只有帶 class_id 才寫 migration 新增的欄位，
  // 否則「尚未跑 migration」的 DB 會回 42703。
  const classRaw = body.class_id;
  const hasClass = classRaw !== undefined && classRaw !== null && text(classRaw) !== "";
  let classId: string | null = null;
  if (hasClass) {
    if (!isUuid(classRaw)) {
      return jsonValidation({ class_id: "課程編號格式錯誤。" }, "請檢查表單內容。");
    }
    classId = text(classRaw);
    // 部分唯一索引含 start_time；寫 null 會讓 NULL 之間不互斥、唯一性失效
    if (text(body.start_time) === "") {
      return jsonValidation(
        { start_time: "帶課程的場次必須填寫開始時間。" },
        "請檢查表單內容。"
      );
    }
  }

  const payload: Record<string, unknown> = {
    session_date: sessionDate,
    title,
    location,
    starts_at: macauTimestamp(sessionDate, start),
    ends_at: macauTimestamp(sessionDate, end),
    capacity,
    note: note || null,
    status: "open",
  };

  if (classId) {
    payload.class_id = classId;
    payload.start_time = start;
    payload.end_time = end;
    payload.coach_name = coachName || null;
    payload.location_override = text(body.location_override) || null;
  }

  const { data, error } = await supabase
    .from("training_sessions")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (error) return mapWriteError("POST /api/admin/sessions insert", error, Boolean(classId));

  revalidatePath("/admin/sessions");
  revalidatePath("/training");

  return jsonOk({ message: `已建立 ${sessionDate} 的訓練場次。`, id: data?.id ?? null });
}

/** 更新：以 id 為準（不再靠日期 upsert），找不到回 404 */
async function updateSession(
  supabase: Supabase,
  id: string,
  body: Record<string, unknown>
): Promise<Response> {
  // 只 select 兩個 schema 版本都存在的欄位（class_id / start_time 是 migration 後才有）
  const { data: existing, error: readError } = await supabase
    .from("training_sessions")
    .select("id, session_date, starts_at, ends_at, capacity, note, status, title, location")
    .eq("id", id)
    .maybeSingle();

  if (readError) return jsonDbError("POST /api/admin/sessions read", readError);
  if (!existing) return jsonNotFound("找不到這筆訓練場次。");

  const current = existing as {
    id: string;
    session_date: string;
    starts_at: string | null;
    ends_at: string | null;
    capacity: number;
    note: string | null;
    status: string;
    title: string;
    location: string;
  };

  /* ---------- 日期 ---------- */
  let sessionDate = current.session_date;
  if (body.session_date !== undefined) {
    sessionDate = text(body.session_date);
    if (!isValidDate(sessionDate)) {
      return jsonValidation({ session_date: "請選擇正確的日期。" }, "請選擇正確的日期。");
    }
  }

  /* ---------- 時間 ---------- */
  let start = macauTimeOf(current.starts_at, "20:00:00");
  if (body.start_time !== undefined && text(body.start_time) !== "") {
    const parsed = normalizeTime(body.start_time);
    if (!parsed) return jsonValidation({ start_time: "時間格式需為 HH:MM。" }, "請檢查表單內容。");
    start = parsed;
  }

  let end = macauTimeOf(current.ends_at, "21:00:00");
  if (body.end_time !== undefined && text(body.end_time) !== "") {
    const parsed = normalizeTime(body.end_time);
    if (!parsed) return jsonValidation({ end_time: "時間格式需為 HH:MM。" }, "請檢查表單內容。");
    end = parsed;
  }

  if (end <= start) {
    return jsonValidation({ end_time: "結束時間需晚於開始時間。" }, "請檢查表單內容。");
  }

  /* ---------- 名額 ---------- */
  let capacity = current.capacity;
  if (body.capacity !== undefined && body.capacity !== null && body.capacity !== "") {
    const parsed = readCapacity(body.capacity);
    if (parsed === null) {
      return jsonValidation({ capacity: "名額需介於 1 與 999 之間。" }, "請檢查表單內容。");
    }
    capacity = parsed;
  }

  /* ---------- 文字欄位（未提供就沿用現值，不因空字串被清空） ---------- */
  const title = text(body.title) || current.title;
  const location = text(body.location) || current.location;
  const note = body.note === undefined ? current.note : text(body.note) || null;
  const coachName = text(body.coach_name);

  const badTitle = tooLong(title, LIMITS.title, "title", "場次名稱");
  if (badTitle) return jsonValidation(badTitle, "請檢查表單內容。");
  const badLocation = tooLong(location, LIMITS.location, "location", "場地名稱");
  if (badLocation) return jsonValidation(badLocation, "請檢查表單內容。");
  const badNote = note ? tooLong(note, LIMITS.note, "note", "備註") : null;
  if (badNote) return jsonValidation(badNote, "請檢查表單內容。");
  const badCoach = tooLong(coachName, LIMITS.coachName, "coach_name", "教練名稱");
  if (badCoach) return jsonValidation(badCoach, "請檢查表單內容。");

  /* ---------- 狀態（未提供就沿用，避免把 cancelled 復活成 open） ---------- */
  let status = current.status as Status;
  if (body.status !== undefined) {
    const raw = text(body.status);
    if (!(STATUSES as readonly string[]).includes(raw)) {
      return jsonValidation({ status: "狀態必須是開放、截止或取消。" }, "請檢查表單內容。");
    }
    status = raw as Status;
  }

  /* ---------- 新班表語意（只有帶 class_id 才寫 migration 欄位） ---------- */
  const classRaw = body.class_id;
  const hasClass = classRaw !== undefined && classRaw !== null && text(classRaw) !== "";
  let classId: string | null = null;
  if (hasClass) {
    if (!isUuid(classRaw)) {
      return jsonValidation({ class_id: "課程編號格式錯誤。" }, "請檢查表單內容。");
    }
    classId = text(classRaw);
    // 舊資料的 starts_at 可能是舊寫法存下的（無偏移，實際差了 8 小時），
    // 由它反推 start_time 會寫錯，因此更新時要求明示時間。
    if (text(body.start_time) === "") {
      return jsonValidation(
        { start_time: "改綁課程時必須同時填寫開始時間。" },
        "請檢查表單內容。"
      );
    }
  }

  const payload: Record<string, unknown> = {
    session_date: sessionDate,
    title,
    location,
    starts_at: macauTimestamp(sessionDate, start),
    ends_at: macauTimestamp(sessionDate, end),
    capacity,
    note,
    status,
  };

  if (classId) {
    payload.class_id = classId;
    payload.start_time = start;
    payload.end_time = end;
    payload.coach_name = coachName || null;
    if (body.location_override !== undefined) {
      payload.location_override = text(body.location_override) || null;
    }
  }

  const { data, error } = await supabase
    .from("training_sessions")
    .update(payload)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return mapWriteError("PATCH /api/admin/sessions update", error, Boolean(classId));
  if (!data) return jsonNotFound("找不到這筆訓練場次。");

  revalidatePath("/admin/sessions");
  revalidatePath("/training");

  return jsonOk({ message: `已更新 ${sessionDate} 的訓練場次。`, id });
}

/** NEW-P3：未實作的方法也要回 JSON（H6），不要讓框架回 405 空 body */
export async function GET() {
  return jsonMethodNotAllowed();
}

export async function PUT() {
  return jsonMethodNotAllowed();
}

export async function DELETE() {
  return jsonMethodNotAllowed();
}
