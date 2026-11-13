"use client";

/**
 * src/app/admin/schedule/api.ts — 月班表頁的請求層與型別
 *
 * 【為什麼不直接用 src/lib/fetch-json.ts】
 * 那個檔的 FetchError 只保留 message 與 fields（見 src/lib/fetch-json.ts:23-29），
 * 把 API 回應的 `code` 丟掉了。本頁必須辨識 SCHEMA_OUTDATED（training_months
 * 表還沒建）才能給客戶「請先執行 migration」的引導，而不是丟一個 500 錯誤；
 * 也要分辨 DUPLICATE 與 HAS_CHECKINS 兩種 409。
 * fetch-json.ts 不在本次可改範圍（會影響 30+ 支既有路由的用法），
 * 因此在本目錄內放一份等價的薄包裝，行為刻意與它一致：
 *   · 只有 HTTP 2xx + content-type 含 application/json 才解析
 *   · ok !== true 一律拋錯，訊息取 server 的 error 欄位（已是可直接顯示的繁中句子）
 * 交付說明有標註這件事，之後若要收斂成全站一份，改 fetch-json.ts 即可。
 *
 * 契約來源：commit 51b2682（src/app/api/admin/training/{months,sessions,classes}）
 */

export type MonthStatus = "draft" | "published";
export type SessionStatus = "open" | "closed" | "cancelled";

export type YearMonth = { year: number; month: number };

export interface TrainingMonthInfo {
  year: number;
  month: number;
  status: MonthStatus;
  /** ISO（UTC，結尾 Z）；未指定時為該月 1 日 00:00 +08 對應的瞬間 */
  publish_at: string | null;
  /** 同上。顯示時一律以 Asia/Macau 轉換 */
  effective_at: string;
  sessions_count: number;
  cancelled_count: number;
}

export interface ScheduleSession {
  id: string;
  session_date: string;
  /** 'HH:MM:SS'（PG time 欄位），顯示與 input 都要 slice(0,5) */
  start_time: string | null;
  end_time: string | null;
  title: string;
  class_id: string | null;
  class_name: string | null;
  class_category: string | null;
  class_color_key: string | null;
  coach_name: string | null;
  location: string | null;
  /** 管理員在這一場特別改過的場地；null = 沿用課程預設 */
  location_override: string | null;
  capacity: number;
  note: string | null;
  status: SessionStatus;
}

export interface TrainingClass {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  color_key: string | null;
  duration_min: number | null;
  capacity: number | null;
  coach_name: string | null;
  location: string | null;
  is_active: boolean;
}

/** 可直接顯示給客戶的錯誤（訊息來自 server 的 error 欄位） */
export class TrainingApiError extends Error {
  code?: string;
  fields?: Record<string, string>;

  constructor(
    message: string,
    extra?: { code?: string; fields?: Record<string, string> }
  ) {
    super(message);
    this.name = "TrainingApiError";
    this.code = extra?.code;
    this.fields = extra?.fields;
  }
}

/** fetch 被 AbortController 取消（切換月份／卸載元件）——不是錯誤，不要顯示 */
export function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

/** 取可顯示的錯誤訊息；非 Error 一律用 fallback */
export function toMessage(err: unknown, fallback = "伺服器錯誤，請稍後再試。"): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** 取錯誤碼（只有 TrainingApiError 有） */
export function toCode(err: unknown): string | undefined {
  return err instanceof TrainingApiError ? err.code : undefined;
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}

const NETWORK_ERROR = "網路中斷，請檢查連線後再試。";

async function trainingRequest<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = options;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      // 後台資料一定要即時：不要讓瀏覽器或中間層回舊的月份／場次
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new TrainingApiError(NETWORK_ERROR);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new TrainingApiError(`伺服器回應異常（HTTP ${res.status}），請稍後再試。`);
  }

  const raw: unknown = await res.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TrainingApiError(`伺服器回應異常（HTTP ${res.status}），請稍後再試。`);
  }

  const data = raw as Record<string, unknown>;
  if (data.ok !== true) {
    const fields =
      data.fields && typeof data.fields === "object" && !Array.isArray(data.fields)
        ? (data.fields as Record<string, string>)
        : undefined;
    throw new TrainingApiError(
      typeof data.error === "string" ? data.error : "伺服器錯誤，請稍後再試。",
      { code: typeof data.code === "string" ? data.code : undefined, fields }
    );
  }

  return data as T;
}

/* =============================================================
 * 端點
 * ============================================================= */

/** 月份清單（含發布狀態與場次數） */
export function fetchTrainingMonths(signal?: AbortSignal) {
  return trainingRequest<{ months: TrainingMonthInfo[] }>("/api/admin/training/months", {
    signal,
  });
}

/** 某月全部場次（含已取消） */
export function fetchTrainingSessions(year: number, month: number, signal?: AbortSignal) {
  return trainingRequest<{
    year: number;
    month: number;
    count: number;
    sessions: ScheduleSession[];
  }>(`/api/admin/training/sessions?year=${year}&month=${month}`, { signal });
}

/** 全部課程（含已停用——編輯舊場次時要能選回原課程） */
export function fetchTrainingClasses(signal?: AbortSignal) {
  return trainingRequest<{ classes: TrainingClass[]; count: number }>(
    "/api/admin/training/classes",
    { signal }
  );
}

export interface MonthActionResult {
  message: string;
  status: MonthStatus;
  publish_at: string | null;
  effective_at: string;
}

/**
 * 發布／取消發布。
 * publish 不帶 publish_at = 該月 1 日 00:00（Asia/Macau）生效，允許預先發布未來月份。
 */
export function postTrainingMonth(body: {
  action: "publish" | "unpublish";
  year: number;
  month: number;
}) {
  return trainingRequest<MonthActionResult>("/api/admin/training/months", {
    method: "POST",
    body,
  });
}

export interface CopyResult {
  message: string;
  created: number;
  skipped: number;
  conflicts: number;
  from: string;
  to: string;
}

/** 從 from 月複製到 to 月（RPC copy_month_sessions） */
export function copyTrainingMonth(from: YearMonth, to: YearMonth) {
  return trainingRequest<CopyResult>("/api/admin/training/sessions", {
    method: "POST",
    body: {
      action: "copy",
      from_year: from.year,
      from_month: from.month,
      to_year: to.year,
      to_month: to.month,
    },
  });
}

export interface SessionPayload {
  session_date: string;
  class_id: string;
  start_time: string;
  end_time: string;
  coach_name?: string;
  location?: string;
  capacity?: number;
  note?: string;
  status?: SessionStatus;
}

export function createTrainingSession(payload: SessionPayload) {
  return trainingRequest<{ message: string; id: string | null }>(
    "/api/admin/training/sessions",
    { method: "POST", body: { action: "create", ...payload } }
  );
}

export function updateTrainingSession(id: string, payload: SessionPayload) {
  return trainingRequest<{ message: string; id: string }>("/api/admin/training/sessions", {
    method: "POST",
    body: { action: "update", id, ...payload },
  });
}

export function deleteTrainingSession(id: string) {
  return trainingRequest<{ message: string; id: string }>("/api/admin/training/sessions", {
    method: "POST",
    body: { action: "delete", id },
  });
}

/* =============================================================
 * 顏色圖例（supabase/migration-schedule-legend.sql）
 * ============================================================= */

/**
 * 一筆圖例。`color_key` 是色票鍵（blue / green / …），不是 hex ——
 * 實際顏色由前台的 colorHex() 決定，換色只改前端一處。
 */
export interface LegendItem {
  color_key: string;
  label: string;
  sort_order: number;
  is_active: boolean;
}

/** 全部圖例（含停用），已依 sort_order 升冪 */
export function fetchScheduleLegend(signal?: AbortSignal) {
  return trainingRequest<{ legend: LegendItem[] }>("/api/admin/training/legend", {
    signal,
  });
}

/** 改單筆圖例；只送有變動的欄位 */
export function updateScheduleLegendItem(body: {
  color_key: string;
  label?: string;
  sort_order?: number;
  is_active?: boolean;
}) {
  return trainingRequest<{ message: string }>("/api/admin/training/legend", {
    method: "POST",
    body: { action: "update", ...body },
  });
}

/** 還原六筆預設圖例 */
export function resetScheduleLegend() {
  return trainingRequest<{ message: string }>("/api/admin/training/legend", {
    method: "POST",
    body: { action: "reset" },
  });
}
