/**
 * src/app/api/admin/training/_shared.ts
 *
 * 定期訓練班表三支後台 API（classes / rules / generate）的共用工具：
 * 管理員授權、參數驗證、DB 錯誤對映、快取失效。
 *
 * 檔名以底線開頭：Next 只把 `route.ts` 當路由，本檔不會產生任何端點。
 *
 * Owner：白客（backend-engineer）
 * 契約：supabase/migration-training-schedule.sql（表與 RPC 為唯一真相）
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isUuid,
  jsonDbError,
  jsonErr,
  jsonForbidden,
  jsonNotConfigured,
  jsonUnauthenticated,
} from "@/lib/api";
import { TRAINING_SCHEDULE_TAG } from "@/lib/queries";

export type Supabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;

/**
 * 授權：未設定 400 → 未登入 401 → 非管理員 403。
 * 成功時回傳 supabase client 與 userId（後者給 writeAuditLog 用）。
 * 模式與 event-registrations / events 等既有路由一致。
 */
export async function authorizeAdmin(): Promise<
  { supabase: Supabase; userId: string } | { res: Response }
> {
  if (!isSupabaseConfigured) return { res: jsonNotConfigured() };

  const supabase = await createClient();
  if (!supabase) return { res: jsonNotConfigured() };

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

  return { supabase, userId: user.id };
}

/* =============================================================
 * 參數驗證工具
 * ============================================================= */

/** 安全取字串（去除前後空白，非字串一律空字串） */
export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 安全取整數並夾在 [min, max]；非數字回 fallback */
export function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** 是否為整數且在範圍內（用於必須嚴格拒絕越界的參數，例如 year / month / weekday） */
export function isIntInRange(value: unknown, min: number, max: number): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** HH:MM 或 HH:MM:SS（00–23 時、00–59 分秒） */
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 把 'HH:MM' 正規化成 'HH:MM:SS'（time 欄位期望帶秒）；非法回 null */
export function normalizeTime(value: unknown): string | null {
  const raw = text(value);
  if (!TIME_RE.test(raw)) return null;
  return raw.length === 5 ? `${raw}:00` : raw;
}

/** 日期字串是否真實存在（擋 2026-02-31 這種） */
export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** 合法 uuid（避免 22P02 直接打到 DB） */
export function requireUuid(value: unknown): string | null {
  return isUuid(value) ? text(value) : null;
}

/* =============================================================
 * 時間：Asia/Macau
 * ============================================================= */

/**
 * Asia/Macau 無夏令時間，固定 UTC+8。
 * 「澳門牆上時間」＝帶 +08:00 偏移的 ISO 字串，
 * 與 SQL 的 `at time zone 'Asia/Macau'` 結果一致。
 *
 * 一定要帶偏移：若寫成 `2026-12-01T20:00:00`（無偏移），PostgREST 會用
 * DB session 時區（UTC）解析，20:00 會被存成 20:00 UTC，
 * 以澳門時間呈現變成隔日 04:00 —— 也就是原本那個 8 小時偏移 bug。
 */
export const MACAU_OFFSET = "+08:00";

/** 「澳門日期 + HH:MM(:SS)」→ 帶偏移的 ISO 字串 */
export function macauTimestamp(date: string, time: string): string {
  return `${date}T${time}${MACAU_OFFSET}`;
}

/**
 * 該月生效時間的預設值：該月 1 日 00:00（Asia/Macau）。
 * 對應 SQL 的 `(make_date(year, month, 1)::timestamp at time zone 'Asia/Macau')`。
 */
export function monthStartISO(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01T00:00:00${MACAU_OFFSET}`;
}

/** 澳門當下的年月（不能用伺服器 UTC 日期，月初／月末會差一個月） */
export function currentMacauMonth(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Macau",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const [y, m] = parts.split("-");
  return { year: Number(y), month: Number(m) };
}

/** year / month 是否為合法整數且在允許範圍（2024–2100 / 1–12） */
export function isMonthInRange(year: unknown, month: unknown): boolean {
  return isIntInRange(year, 2024, 2100) && isIntInRange(month, 1, 12);
}

/* =============================================================
 * 409：業務衝突
 * ============================================================= */

/**
 * 409 業務衝突（自建，不用 jsonErr）。
 *
 * 原因：`ApiErrorCode`（src/lib/api.ts:13-23）只有 CONFLICT / IN_USE 等通用碼，
 * 沒有本次需要的 DUPLICATE / HAS_CHECKINS；而 api.ts 不在本模組可改範圍內
 * （改它會影響全站 30+ 支路由的錯誤碼契約）。
 * 因此這裡直接組 Response，形狀仍是 { ok:false, error, code }，與 jsonErr 一致，
 * 前端與測試端只需多辨識這幾個 code 值。
 */
export type TrainingConflictCode = "DUPLICATE" | "HAS_CHECKINS";

export function jsonTrainingConflict(
  code: TrainingConflictCode,
  error: string
): Response {
  return NextResponse.json({ ok: false, error, code }, { status: 409 });
}

/* =============================================================
 * DB 錯誤對映
 * ============================================================= */

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

/**
 * 資料表／函式還沒建（客戶尚未貼上 migration）。
 * - 42P01 undefined_table
 * - 42703 undefined_column（migration 貼到一半）
 * - 42883 undefined_function（RPC 未建）
 * - PGRST202 / PGRST204 / PGRST205（PostgREST schema cache 找不到函式／欄位／表）
 */
export function isSchemaMissing(error: unknown): boolean {
  const code = pgCode(error);
  if (["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(code)) return true;
  const message = pgMessage(error);
  return /relation .* does not exist|column .* does not exist|function .* does not exist|could not find the (function|table|column)/i.test(
    message
  );
}

/** 唯一鍵衝突（slug 重複等） */
export function isUniqueViolation(error: unknown): boolean {
  return pgCode(error) === "23505";
}

/** 外鍵不存在（class_id 指向不存在的課程） */
export function isForeignKeyViolation(error: unknown): boolean {
  return pgCode(error) === "23503";
}

/**
 * 統一的 DB 錯誤回應：
 * 未建表 → 500 SCHEMA_OUTDATED（文案含 migration 檔名，方便客戶照着貼；不含任何 SQL／路徑細節）
 * 其餘走 jsonDbError（P0001 查無資料 → 404、22P02 → 400、其他 → 500 並寫 server log）
 *
 * @param migration 要提示客戶執行的 migration 檔名。
 *   月份相關功能用 migration-training-months.sql；其餘沿用預設的舊檔名。
 */
export function jsonTrainingDbError(
  where: string,
  error: unknown,
  migration = "supabase/migration-training-schedule.sql"
): Response {
  if (isSchemaMissing(error)) {
    return jsonErr(
      `訓練班表資料尚未建立，請先執行 ${migration}。`,
      "SCHEMA_OUTDATED",
      500
    );
  }
  return jsonDbError(where, error);
}

/* =============================================================
 * 快取失效
 * ============================================================= */

/**
 * 寫入後失效班表快取。
 * - revalidateTag：前台 getScheduleMonth / getAvailableMonths / getTrainingClasses
 *   （tag `training-schedule`）。Next 16 的 revalidateTag 需要第二個參數
 *   （cache life profile），這裡與 queries.ts 的 `revalidate: 60` 對齊；
 *   寫法复刻 site-content / site-settings。
 * - revalidatePath：前台活動頁與後台班表頁（本次由頁面作者決定路徑，
 *   後端只負責在資料變動時通知這兩個路徑失效）。
 *   註：這兩個路徑會連帶被既有的 classes / rules / generate 三支路由一併失效，
 *   屬無害副作用（多失效一次只是多算一次，不會出錯）。
 */
export function revalidateTrainingSchedule(): void {
  try {
    revalidateTag(TRAINING_SCHEDULE_TAG, { expire: 60 });
  } catch (err) {
    // 在非請求情境（例如指令碼）呼叫時 revalidateTag 會拋錯，不影響已完成的 DB 寫入
    console.warn("[training] revalidateTag 失敗（不影響主流程）：", err);
  }

  for (const path of ["/events", "/admin/schedule"]) {
    try {
      revalidatePath(path);
    } catch (err) {
      console.warn(`[training] revalidatePath(${path}) 失敗（不影響主流程）：`, err);
    }
  }
}
