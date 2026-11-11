/**
 * POST /api/admin/hyrox/review — 審核 HYROX 報名的付款截圖（管理員限定）
 *
 * 契約：{ registration_id, decision:'confirmed' | 'rejected', note? }
 *   · 全部經 authorizeAdmin()：未設定 400 / 未登入 401 / 非管理員 403
 *   · registration_id 非 uuid → 400 VALIDATION
 *   · decision 不合法 → 400 VALIDATION（fields.decision）
 *   · note > 500 字 → 400 VALIDATION
 *   · 不是 HYROX 場次的報名 → 404 NOT_FOUND（把這支端點限制在本模組）
 *   · 成功 → 呼叫 RPC review_event_payment（狀態機 + 同交易發分）
 *     然後 writeAuditLog(supabase, actorId, 'hyrox', decision, 摘要)
 *   · RPC 的 code 原樣回傳：ALREADY_REVIEWED → 409、NOT_FOUND → 404、
 *     INVALID_DECISION / INVALID_ARGUMENT → 400、NOT_ADMIN → 403
 *
 * 【為什麼不自己 update】
 *   review_event_payment 在**同一個交易**內改狀態並經 award_paid_event_bonus
 *   → credit_points 發分（migration-paid-events-1.sql E/F 段）。自己 update 會
 *   出現「已通過但沒發分」，而且繞過 ledger 與防重（uq_point_tx_per_ref）。
 *
 * Owner：白客（backend-engineer）
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { authorizeAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { HYROX_EVENTS_TAG } from "@/lib/queries";
import {
  isUuid,
  jsonBadJson,
  jsonDbError,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";
import {
  HYROX_SERIES,
  hyroxErr,
  type HyroxErrorCode,
} from "@/app/api/hyrox/_shared/contract";
import type { PaymentStatus } from "@/lib/types";

type RpcResult = {
  ok?: boolean;
  code?: string;
  payment_status?: PaymentStatus;
  award?: Record<string, unknown>;
};

/**
 * RPC code → HTTP 狀態與文案（code 原樣回傳，契約要求）。
 * 註：RPC 對「不是 pending_review」的列回 ALREADY_REVIEWED（附 payment_status），
 * 這是正常的情境（例如另一位管理員已審完），所以 409 而不是 500。
 */
const RPC_OUTCOME: Record<
  string,
  { code: HyroxErrorCode; status: number; message: string }
> = {
  NOT_FOUND: { code: "NOT_FOUND", status: 404, message: "找不到這筆報名。" },
  ALREADY_REVIEWED: {
    code: "ALREADY_REVIEWED",
    status: 409,
    message: "這筆報名已經審核過，請重新整理後再試。",
  },
  INVALID_DECISION: {
    code: "INVALID_DECISION",
    status: 400,
    message: "審核結果只能是通過或退回。",
  },
  INVALID_ARGUMENT: { code: "VALIDATION", status: 400, message: "資料格式錯誤。" },
  NOT_ADMIN: { code: "FORBIDDEN", status: 403, message: "權限不足。" },
};

/** note 的長度上限（與 DB check 的 admin_note ≤ 500 對齊） */
const NOTE_MAX = 500;

export async function POST(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const registrationId =
      typeof body.registration_id === "string" ? body.registration_id.trim() : "";
    if (!registrationId) return jsonValidation({ registration_id: "缺少報名編號。" });
    if (!isUuid(registrationId)) {
      return jsonValidation({ registration_id: "編號格式錯誤。" });
    }

    const decision = typeof body.decision === "string" ? body.decision.trim() : "";
    if (decision !== "confirmed" && decision !== "rejected") {
      return jsonValidation({ decision: "審核結果只能是 confirmed 或 rejected。" });
    }

    let note: string | null = null;
    if (body.note !== undefined && body.note !== null) {
      if (typeof body.note !== "string") {
        return jsonValidation({ note: "備註格式錯誤。" });
      }
      const trimmed = body.note.trim();
      if (Array.from(trimmed).length > NOTE_MAX) {
        return jsonValidation({ note: `備註最多 ${NOTE_MAX} 個字。` });
      }
      note = trimmed === "" ? null : trimmed;
    }

    // 先把這支端點限制在 HYROX 模組內：確認報名屬於 series='hyrox' 的場次
    const { data: reg, error: readErr } = await supabase
      .from("event_registrations")
      .select("id, payment_status, event:events(id, series)")
      .eq("id", registrationId)
      .maybeSingle();

    if (readErr) return jsonInternal("POST /api/admin/hyrox/review read", readErr);
    if (!reg) return jsonNotFound("找不到這筆報名。");

    const relatedEvent = (
      reg as unknown as { event: { id: string; series: string | null } | null }
    ).event;
    if (!relatedEvent || relatedEvent.series !== HYROX_SERIES) {
      return jsonNotFound("找不到這筆報名。");
    }

    // 走 RPC：狀態機 + 同交易發分（不自己 update）
    const { data, error } = await supabase.rpc("review_event_payment", {
      p_registration_id: registrationId,
      p_decision: decision,
      p_note: note,
    });

    if (error) return jsonDbError("POST /api/admin/hyrox/review rpc", error);

    const row = (data ?? {}) as RpcResult;

    if (row.ok !== true) {
      const code = row.code ?? "INTERNAL";
      const outcome = RPC_OUTCOME[code];
      if (!outcome) {
        return jsonInternal("POST /api/admin/hyrox/review unexpected", { code, row });
      }
      return hyroxErr(outcome.code, outcome.status, outcome.message, {
        payload: "payment_status" in row ? { payment_status: row.payment_status } : undefined,
      });
    }

    // 稽核日誌（best-effort，失敗不影響已完成的審核；見 src/lib/audit.ts 的取捨）
    await writeAuditLog(
      supabase,
      actorId,
      "hyrox",
      decision,
      decision === "confirmed"
        ? `HYROX 報名付款審核通過（${registrationId}）`
        : `HYROX 報名付款審核退回（${registrationId}）`
    );

    // 前台狀態與後台名單／統計都會變
    revalidatePath("/hyrox");
    revalidatePath("/dashboard");
    revalidatePath("/admin/hyrox");
    revalidateTag(HYROX_EVENTS_TAG, { expire: 60 });

    return jsonOk({
      registration: { id: registrationId, payment_status: row.payment_status ?? decision },
      // RPC 內部的發分結果（skipped / points / reason），給後台顯示「已發 30 分」
      award: row.award ?? null,
    });
  } catch (err) {
    return jsonDbError("POST /api/admin/hyrox/review", err);
  }
}

/** H6：未實作的方法也要回 JSON */
export async function GET() {
  return jsonMethodNotAllowed();
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
