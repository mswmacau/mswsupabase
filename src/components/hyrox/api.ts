/**
 * src/components/hyrox/api.ts — HYROX 報名相關 API 呼叫（client only）
 *
 * 為什麼不用 @/lib/fetch-json 的 postJson：
 *   報名契約的錯誤回應帶 `code`（VALIDATION / EVENT_CLOSED / ALREADY_REGISTERED …），
 *   前端要按 code 分流（例如 ALREADY_REGISTERED 要引導去看報名狀態、PROOF_REQUIRED
 *   要回去第三步重傳）。FetchError 只保留 message 與 fields，code 會丟掉，
 *   所以這裡自己包一層：**不拋錯，回傳判別式聯集**，呼叫端不會漏接錯誤分支。
 *
 * 失敗一律轉成可直接顯示的中文訊息；網路層與非 JSON 回應各給明確文案。
 */

import type { PaymentStatus } from "@/lib/types";

export interface HyroxApiFailure {
  ok: false;
  /** 契約錯誤碼；網路錯誤或未預期格式時為 "NETWORK" / "BAD_RESPONSE" */
  code: string;
  error: string;
  fields?: Record<string, string>;
}

export type HyroxApiResult<T> = ({ ok: true } & T) | HyroxApiFailure;

const NETWORK_ERROR = "網路中斷，請檢查連線後再試。";

/** 送出請求；永遠 resolve（錯誤以 {ok:false} 回傳） */
async function send<T extends object>(
  url: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<HyroxApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, code: "NETWORK", error: NETWORK_ERROR };
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    // 最常見成因：端點還沒實作（回 HTML 404 頁）。如實講，不要假裝成功。
    return {
      ok: false,
      code: "BAD_RESPONSE",
      error:
        res.status === 404
          ? "這個功能還未接通（伺服器找不到接口），請聯絡管理員。"
          : `伺服器回應異常（HTTP ${res.status}），請稍後再試。`,
    };
  }

  const data: unknown = await res.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      ok: false,
      code: "BAD_RESPONSE",
      error: `伺服器回應異常（HTTP ${res.status}），請稍後再試。`,
    };
  }

  const obj = data as Record<string, unknown>;
  if (obj.ok === false) {
    return {
      ok: false,
      code: typeof obj.code === "string" ? obj.code : "ERROR",
      error:
        typeof obj.error === "string" ? obj.error : "提交失敗，請稍後再試。",
      fields:
        obj.fields && typeof obj.fields === "object"
          ? (obj.fields as Record<string, string>)
          : undefined,
    };
  }

  return { ok: true, ...(obj as unknown as T) };
}

/** 送出 JSON（POST）；永遠 resolve */
export function postHyrox<T extends object>(
  url: string,
  body: unknown
): Promise<HyroxApiResult<T>> {
  return send<T>(url, "POST", body);
}

/** 讀取 JSON（GET）；永遠 resolve */
export function getHyrox<T extends object>(url: string): Promise<HyroxApiResult<T>> {
  return send<T>(url, "GET");
}

/* =============================================================
 * POST /api/hyrox/register
 * ============================================================= */

export interface RegisterPayload {
  event_id: string;
  profile: {
    full_name: string;
    gender: "male" | "female" | "undisclosed";
    phone: string;
    id_last4: string;
  };
  answers: {
    group_pref: string;
    weekly_freq: string;
    longest_run: string;
  };
  disclaimer_accepted: boolean;
  proof_path: string;
}

export type RegisterResponse = {
  registration: { id: string; payment_status: PaymentStatus };
};

/* =============================================================
 * POST /api/hyrox/resubmit-proof
 * ============================================================= */

export interface ResubmitPayload {
  registration_id: string;
  proof_path: string;
}
