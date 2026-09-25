/**
 * src/lib/fetch-json.ts — 統一 JSON 請求與「非 JSON 回應」處理
 *
 * Owner：方砚。對齊 SPEC-R6.md §0.4 共通處理：
 *   res.ok === true 才解析；先檢查 content-type 是否含 application/json，
 *   否則顯示「伺服器回應異常（HTTP {status}），請稍後再試。」
 *
 * 失敗一律拋出 FetchError（含可直接顯示給客戶的 message 與欄位級錯誤 fields）。
 */

export interface ApiErrorShape {
  ok: false;
  error: string;
  code?: string;
  fields?: Record<string, string>;
}

/** 可被前端直接顯示錯誤訊息的錯誤類別 */
export class FetchError extends Error {
  fields?: Record<string, string>;
  constructor(message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "FetchError";
    this.fields = fields;
  }
}

/** 一般錯誤訊息（網路層失敗用） */
const NETWORK_ERROR = "網路中斷，請檢查連線後再試。";

interface CallOptions {
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
}

/**
 * 統一發出 JSON 請求。成功回傳解析後的 data（已去除 ok 旗標）；
 * 失敗（含非 JSON 回應、HTTP 非 2xx、業務錯誤）拋出 FetchError。
 */
export async function requestJson<T>(
  url: string,
  options: CallOptions = {}
): Promise<T> {
  const { method = "POST", body } = options;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new FetchError(NETWORK_ERROR);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new FetchError(
      `伺服器回應異常（HTTP ${res.status}），請稍後再試。`
    );
  }

  const data: unknown = await res.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new FetchError(
      `伺服器回應異常（HTTP ${res.status}），請稍後再試。`
    );
  }

  const obj = data as Record<string, unknown> & Partial<ApiErrorShape>;
  if (obj.ok === false) {
    throw new FetchError(
      typeof obj.error === "string" ? obj.error : "伺服器錯誤，請稍後再試。",
      obj.fields
    );
  }

  return obj as unknown as T;
}

/** POST 便捷方法 */
export function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, { method: "POST", body });
}

/** PATCH 便捷方法 */
export function patchJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, { method: "PATCH", body });
}

/** DELETE 便捷方法（body 可選） */
export function deleteJson<T>(url: string, body?: unknown): Promise<T> {
  return requestJson<T>(url, { method: "DELETE", body });
}
