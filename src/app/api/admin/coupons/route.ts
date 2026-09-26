import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  jsonBadJson,
  jsonConflict,
  jsonErr,
  jsonForbidden,
  isUuid,
  jsonDbError,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotConfigured,
  jsonNotFound,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";

/**
 * 管理員：批量發券（POST）／核銷優惠券（PATCH）
 *
 * 契約：SPEC-R6.md §0.4（錯誤碼與文案）、H6（任何情況都要回 JSON）
 *
 * 【R6 驗收 P1-2 修正】兩支 handler 原本直接 `await request.json()`，
 * 畸形 body 會讓例外裸奔成 HTTP 500 + 空 body（違反 H6）。
 * 現在比照對照組（/api/runs、/api/admin/events）改用 readJson() + jsonBadJson()，
 * 並全支包 try/catch，保證任何分支都回 application/json。
 *
 * 【R6 驗收 P1-1 修正】PATCH 不再只看 RPC 有無 error，
 * 而是依 public.redeem_coupon() 回傳的 result 判斷：
 *   not_found    → 404 找不到這筆資料。
 *   already_used → 409 此優惠券已核銷。
 *   ok           → 200（才真的回報核銷成功）
 */

/** redeem_coupon() 回傳的單列結果 */
type RedeemRow = {
  result?: string;
  coupon_id?: string;
  coupon_title?: string | null;
  member_name?: string | null;
};

/** 安全取字串（避免非字串欄位讓 .trim() 拋例外） */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 批量發券（管理員） */
export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured) return jsonNotConfigured();

    const supabase = await createClient();
    if (!supabase) return jsonErr("客戶端初始化失敗。", "INTERNAL", 500);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonUnauthenticated();

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role !== "admin") return jsonForbidden();

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const rawIds = Array.isArray(body.user_ids) ? body.user_ids : [];
    const userIds = rawIds.filter(
      (v): v is string => typeof v === "string" && v.trim() !== ""
    );
    if (!userIds.length) return jsonValidation({}, "請至少選擇一位會員。");
    // NEW-P2-1：user_ids 逐筆驗 UUID，不讓 Postgres 22P02 變成 500
    if (userIds.length !== rawIds.length || !userIds.every(isUuid)) {
      return jsonValidation({ user_ids: "編號格式錯誤。" });
    }

    const daysRaw = Number(body.days ?? 90);
    const days = Number.isFinite(daysRaw)
      ? Math.min(3650, Math.max(1, Math.trunc(daysRaw)))
      : 90;

    const { error } = await supabase.rpc("issue_coupons", {
      p_user_ids: userIds,
      p_title: text(body.title) || "MSW 專屬優惠券",
      p_desc: text(body.description) || null,
      p_month: text(body.month) || null,
      p_days: days,
    });

    if (error) return jsonDbError("POST /api/admin/coupons issue", error);

    revalidatePath("/admin/monthly");
    revalidatePath("/admin/coupons");
    revalidatePath("/admin");

    return jsonOk({ message: `已發放 ${userIds.length} 張優惠券。` });
  } catch (err) {
    return jsonDbError("POST /api/admin/coupons", err);
  }
}

/** 核銷優惠券 */
export async function PATCH(request: Request) {
  try {
    if (!isSupabaseConfigured) return jsonNotConfigured();

    const supabase = await createClient();
    if (!supabase) return jsonErr("客戶端初始化失敗。", "INTERNAL", 500);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonUnauthenticated();

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role !== "admin") return jsonForbidden();

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const code = text(body.code);
    if (!code) return jsonValidation({}, "請輸入優惠券代碼。");

    const { data, error } = await supabase.rpc("redeem_coupon", { p_code: code });
    if (error) return jsonDbError("PATCH /api/admin/coupons redeem", error);

    const rows = (Array.isArray(data) ? data : []) as RedeemRow[];
    const result = typeof rows[0]?.result === "string" ? rows[0].result : "not_found";

    // 查無此券（含代碼不存在）：不可回報成功
    if (result === "not_found") return jsonNotFound();
    // 已核銷／已失效：拒絕重複核銷，DB 不變
    if (result === "already_used") return jsonConflict("此優惠券已核銷。");
    if (result !== "ok") return jsonInternal("PATCH /api/admin/coupons unknown result", result);

    revalidatePath("/admin/coupons");

    return jsonOk({
      message: `優惠券 ${code} 已核銷。`,
      coupon_title: rows[0]?.coupon_title ?? null,
      member_name: rows[0]?.member_name ?? null,
    });
  } catch (err) {
    return jsonDbError("PATCH /api/admin/coupons", err);
  }
}

/** NEW-P3：未實作的方法也要回 JSON（H6），不要讓框架回 405 空 body */
export async function GET() {
  return jsonMethodNotAllowed();
}
