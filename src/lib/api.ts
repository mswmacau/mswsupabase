/**
 * src/lib/api.ts — Route Handler 共用的錯誤碼與 JSON 回應 helper
 *
 * Owner：白客（backend-engineer）；前端不直接 import 本檔。
 * 契約來源：SPEC-R6.md §0.4
 *
 * 硬性約束 H6：所有 Route Handler 任何情況都必須回傳 JSON，
 * 禁止讓例外裸奔成 Next 的 HTML 錯誤頁（那是需求 D「網路錯誤」的幫兇）。
 */

import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "SUPABASE_NOT_CONFIGURED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "STORAGE"
  | "INTERNAL";

/** 成功：一律帶 ok:true，其餘攤平在同一層 */
export type ApiOk = { ok: true } & Record<string, unknown>;

/** 失敗：error 是要直接顯示給終端客戶看的繁中句子，不含任何內部細節 */
export type ApiErr = {
  ok: false;
  error: string;
  code?: ApiErrorCode;
  fields?: Record<string, string>;
};

function json(body: ApiOk | ApiErr, status: number) {
  return NextResponse.json(body, { status });
}

/** 成功回應；其餘欄位攤平在同一層 */
export function jsonOk(payload?: Record<string, unknown>, status = 200) {
  return json({ ok: true, ...(payload ?? {}) } as ApiOk, status);
}

/** 失敗回應（可帶欄位級錯誤） */
export function jsonErr(
  error: string,
  code: ApiErrorCode,
  status: number,
  extra?: { fields?: Record<string, string> }
) {
  const body: ApiErr = { ok: false, error, code };
  if (extra?.fields && Object.keys(extra.fields).length > 0) body.fields = extra.fields;
  return json(body, status);
}

/* =============================================================
 * 共通錯誤（文案與 HTTP status 一字不改，見 §0.4 對照表）
 * ============================================================= */

/** 400 尚未連接 Supabase。 */
export const jsonNotConfigured = () =>
  jsonErr("尚未連接 Supabase。", "SUPABASE_NOT_CONFIGURED", 400);

/** 401 登入逾期，請重新登入。 */
export const jsonUnauthenticated = () =>
  jsonErr("登入逾期，請重新登入。", "UNAUTHENTICATED", 401);

/** 403 權限不足。 */
export const jsonForbidden = () => jsonErr("權限不足。", "FORBIDDEN", 403);

/** 400 資料格式錯誤。（JSON parse 失敗） */
export const jsonBadJson = () => jsonErr("資料格式錯誤。", "VALIDATION", 400);

/** 400 請檢查表單內容。 + fields */
export const jsonValidation = (
  fields?: Record<string, string>,
  error = "請檢查表單內容。"
) => jsonErr(error, "VALIDATION", 400, { fields });

/** 404 找不到這筆資料。 */
export const jsonNotFound = (error = "找不到這筆資料。") =>
  jsonErr(error, "NOT_FOUND", 404);

/** 409 狀態衝突 */
export const jsonConflict = (error: string) => jsonErr(error, "CONFLICT", 409);

/** 502 圖片處理失敗，請重新上傳圖片。 */
export const jsonStorage = (error = "圖片處理失敗，請重新上傳圖片。") =>
  jsonErr(error, "STORAGE", 502);

/** 500 伺服器錯誤，請稍後再試。真實錯誤只寫 server log，不回傳給瀏覽器。 */
export const jsonInternal = (where: string, cause?: unknown) => {
  console.error(`[api] ${where} failed:`, cause);
  return jsonErr("伺服器錯誤，請稍後再試。", "INTERNAL", 500);
};

/**
 * 保險用的 handler 包膜：任何拋出的例外都變成 JSON 500，
 * 確保 content-type 永遠是 application/json（BE-16 ①）。
 *
 * 用法：
 *   export const GET = withJson(() => jsonOk({ ts: Date.now() }));
 */
export function withJson<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      return jsonInternal(handler.name || "handler", err);
    }
  };
}

/** 讀取 JSON body；失敗回傳 null（呼叫端自行回 jsonBadJson()） */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
