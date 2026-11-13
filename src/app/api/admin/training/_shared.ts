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

import { revalidateTag } from "next/cache";
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
 */
export function jsonTrainingDbError(where: string, error: unknown): Response {
  if (isSchemaMissing(error)) {
    return jsonErr(
      "訓練班表資料表尚未建立，請先執行 supabase/migration-training-schedule.sql。",
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
 * - revalidateTag：前台 getMonthSchedule / getTrainingClasses（tag `training-schedule`）
 *   Next 16 的 revalidateTag 需要第二個參數（cache life profile），
 *   這裡與 queries.ts 的 `revalidate: 60` 對齊；寫法复刻 site-content / site-settings。
 * - 不做 revalidatePath：本次不動任何頁面，路徑由頁面作者自行決定。
 */
export function revalidateTrainingSchedule(): void {
  try {
    revalidateTag(TRAINING_SCHEDULE_TAG, { expire: 60 });
  } catch (err) {
    // 在非請求情境（例如指令碼）呼叫時 revalidateTag 會拋錯，不影響已完成的 DB 寫入
    console.warn("[training] revalidateTag 失敗（不影響主流程）：", err);
  }
}
