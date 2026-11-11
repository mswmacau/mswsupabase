/**
 * POST /api/hyrox/resubmit-proof — 會員重交付款截圖（被退回後）
 *
 * 契約：{ registration_id, proof_path }
 *   · 未登入 → 401 UNAUTHENTICATED
 *   · body 畸形 / registration_id 非 uuid → 400 VALIDATION
 *   · proof_path 缺漏或不合規則 → 400 PROOF_REQUIRED
 *   · 不是自己那一筆（或不存在）→ 404 NOT_FOUND（故意不區分，避免探測他人報名）
 *   · 目前狀態不是 'rejected' → 409 NOT_IN_REJECTED_STATE（附 payment_status）
 *   · 正常 → 呼叫 RPC submit_event_payment_proof → 200
 *   · RPC 回傳的 code 原樣沿用（NOT_FOUND / ALREADY_CONFIRMED / INVALID_ARGUMENT …）
 *
 * 【為什麼一定要走 RPC，不直接 update】
 *   event_registrations 的表層 grant 只有 select/insert/delete，update 政策也只給
 *   管理員（migration-event-registrations.sql:110-117）。開放會員 update 等於讓會員
 *   自己把 payment_status 改成 'confirmed' 自己過審＋發分。RPC 是 security definer
 *   的窄門：只改 5 個欄位、只改自己那一列（migration-paid-events-1.sql H 段）。
 *
 * H6：全支包 try/catch，任何情況都回 JSON。
 * Owner：白客（backend-engineer）
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isUuid,
  jsonBadJson,
  jsonDbError,
  jsonErr,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonNotConfigured,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";
import {
  hyroxErr,
  parseProofPath,
  proofObjectExists,
  type HyroxErrorCode,
} from "../_shared/contract";

/** RPC submit_event_payment_proof 的回傳形狀（jsonb） */
type RpcResult = {
  ok?: boolean;
  code?: string;
  payment_status?: string;
};

/**
 * RPC code → HTTP 狀態與文案。
 *
 * 契約寫「錯誤碼沿用 RPC 回傳的 code」，所以 code 一律照抄（唯一例外是
 * INVALID_ARGUMENT：屬「輸入格式」家族，統一成契約的 VALIDATION）。
 * 註：實際的 RPC 拒絕已通過／已完成的列時回的是 **ALREADY_CONFIRMED**，
 * 不是契約假設的 NOT_IN_REJECTED_STATE —— 見交付說明「契約需要調整的地方」。
 */
const RPC_OUTCOME: Record<
  string,
  { code: HyroxErrorCode; status: number; message: string }
> = {
  NOT_FOUND: { code: "NOT_FOUND", status: 404, message: "找不到這筆報名。" },
  ALREADY_CONFIRMED: {
    code: "ALREADY_CONFIRMED",
    status: 409,
    message: "這筆報名已審核通過，不能更換截圖。",
  },
  NOT_IN_REJECTED_STATE: {
    code: "NOT_IN_REJECTED_STATE",
    status: 409,
    message: "這筆報名目前不需要重交截圖。",
  },
  PROOF_REQUIRED: { code: "PROOF_REQUIRED", status: 400, message: "請先上傳付款截圖。" },
  INVALID_ARGUMENT: { code: "VALIDATION", status: 400, message: "資料格式錯誤。" },
  UNAUTHENTICATED: {
    code: "UNAUTHENTICATED",
    status: 401,
    message: "登入逾期，請重新登入。",
  },
};

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured) return jsonNotConfigured();

    const supabase = await createClient();
    if (!supabase) return jsonErr("客戶端初始化失敗。", "INTERNAL", 500);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonUnauthenticated();

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const registrationId =
      typeof body.registration_id === "string" ? body.registration_id.trim() : "";
    if (!registrationId) return jsonValidation({ registration_id: "缺少報名編號。" });
    if (!isUuid(registrationId)) {
      return jsonValidation({ registration_id: "編號格式錯誤。" });
    }

    // proof_path：形狀先本地驗（必須落在自己的 uid 目錄）
    const proof = parseProofPath(body.proof_path, user.id);
    if (!proof.ok) {
      return hyroxErr(
        "PROOF_REQUIRED",
        400,
        proof.reason === "missing"
          ? "請先上傳付款截圖。"
          : "付款截圖的路徑不正確，請重新上傳。"
      );
    }
    const proofExists = await proofObjectExists(supabase, proof.path);
    if (proofExists === false) {
      return hyroxErr("PROOF_REQUIRED", 400, "找不到你上傳的截圖，請重新上傳。");
    }

    // 先查後寫：本人那筆、且目前是「已退回」才准重交
    // （RLS event_reg_select_own_or_admin 已限制只能讀自己的列，這裡再用 user_id 條件把關）
    const { data: reg, error: readErr } = await supabase
      .from("event_registrations")
      .select("id, user_id, payment_status")
      .eq("id", registrationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (readErr) return jsonDbError("POST /api/hyrox/resubmit-proof read", readErr);
    // 不是自己的 → 一律 404（不區分 403，避免拿 id 探測他人報名是否存在）
    if (!reg) return jsonNotFound("找不到這筆報名。");

    const currentStatus = (reg as { payment_status: string }).payment_status;
    if (currentStatus !== "rejected") {
      return hyroxErr(
        "NOT_IN_REJECTED_STATE",
        409,
        "這筆報名目前不需要重交截圖。",
        { payload: { payment_status: currentStatus } }
      );
    }

    // 走 RPC（definer 窄門）；金額不傳 → 保留原本自填金額
    const { data, error } = await supabase.rpc("submit_event_payment_proof", {
      p_registration_id: registrationId,
      p_proof_path: proof.path,
      p_amount_cents: null,
    });

    if (error) return jsonDbError("POST /api/hyrox/resubmit-proof rpc", error);

    const row = (data ?? {}) as RpcResult;
    if (row.ok === true) {
      revalidatePath("/hyrox");
      revalidatePath("/dashboard");
      return jsonOk({
        registration: {
          id: registrationId,
          payment_status: row.payment_status ?? "pending_review",
        },
      });
    }

    const code = row.code ?? "INTERNAL";
    const outcome = RPC_OUTCOME[code];
    if (!outcome) {
      // 非預期的 RPC 失敗：細節只寫 server log，不回傳給瀏覽器
      return jsonDbError("POST /api/hyrox/resubmit-proof unexpected", {
        code,
        message: row,
      });
    }

    return hyroxErr(outcome.code, outcome.status, outcome.message, {
      payload: "payment_status" in row ? { payment_status: row.payment_status } : undefined,
    });
  } catch (err) {
    return jsonDbError("POST /api/hyrox/resubmit-proof", err);
  }
}

/** H6：未實作的方法也要回 JSON */
export async function GET() {
  return jsonMethodNotAllowed();
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
