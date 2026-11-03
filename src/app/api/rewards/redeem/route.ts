import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isUuid,
  jsonBadJson,
  jsonConflict,
  jsonErr,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotConfigured,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";

/**
 * POST /api/rewards/redeem — 兌換禮品
 *
 * 契約（DB 為唯一權威）：
 *   入：{ reward_id: uuid, idempotency_key: string(16–64) }
 *   出：{ ok:true, code, status, duplicate, points_balance, expires_at }
 *   錯：{ ok:false, error, code }
 *
 * 扣分／扣庫存全在 rpc('redeem_reward') 的單一交易內完成；
 * 本 route 只負責驗登入、驗格式、把 RPC 的錯誤碼翻成客人看得懂的繁中句子。
 */
export async function GET() {
  return jsonMethodNotAllowed();
}

type RedeemResult = {
  ok?: boolean;
  code?: string;
  status?: string;
  duplicate?: boolean;
  points_balance?: number;
  expires_at?: string;
  points?: number;
  required?: number;
  limit?: number;
  used?: number;
};

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured) return jsonNotConfigured();

    const supabase = await createClient();
    if (!supabase) return jsonNotConfigured();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonUnauthenticated();

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const rewardId = typeof body.reward_id === "string" ? body.reward_id.trim() : "";
    const idempotencyKey =
      typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";

    if (!isUuid(rewardId) || idempotencyKey.length < 16 || idempotencyKey.length > 64) {
      return jsonValidation({}, "兌換資料不完整，請重新整理頁面再試。");
    }

    const { data, error } = await supabase.rpc("redeem_reward", {
      p_reward_id: rewardId,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      // PGRST202：函式未部署（例如環境未跑 migration）——不可以炸成 500 HTML
      if (error.code === "PGRST202") {
        return jsonErr("禮品換領暫未開放。", "SCHEMA_OUTDATED", 503);
      }
      return jsonInternal("POST /api/rewards/redeem rpc", error);
    }

    const res = (data ?? {}) as RedeemResult;

    if (res.ok !== true) {
      switch (res.code) {
        case "UNAUTHENTICATED":
          return jsonUnauthenticated();
        case "INSUFFICIENT_POINTS":
          return jsonConflict(
            `積分不足：你現時有 ${Number(res.points ?? 0)} 分，這件禮品需要 ${Number(
              res.required ?? 0
            )} 分。`
          );
        case "OUT_OF_STOCK":
          return jsonConflict("這件禮品已換完。");
        case "PER_USER_LIMIT":
          return jsonConflict(
            `每人限換 ${Number(res.limit ?? 0)} 件，你已換 ${Number(res.used ?? 0)} 件。`
          );
        case "REWARD_INACTIVE":
          return jsonConflict("這件禮品已下架。");
        case "FEATURE_OFF":
          return jsonErr("禮品換領暫未開放。", "FORBIDDEN", 403);
        case "RETRY":
          return jsonConflict("系統繁忙，請再按一次確認。");
        default:
          return jsonInternal("POST /api/rewards/redeem unexpected", res.code);
      }
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/rewards");
    revalidatePath("/dashboard/redemptions");
    revalidatePath("/dashboard/points");

    return jsonOk({
      code: res.code ?? null,
      status: res.status ?? null,
      duplicate: res.duplicate === true,
      points_balance:
        typeof res.points_balance === "number" ? res.points_balance : null,
      expires_at: res.expires_at ?? null,
    });
  } catch (err) {
    return jsonInternal("POST /api/rewards/redeem", err);
  }
}
