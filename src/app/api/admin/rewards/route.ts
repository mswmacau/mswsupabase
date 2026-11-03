import { revalidatePath } from "next/cache";
import { authorizeAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import {
  isUuid,
  jsonBadJson,
  jsonDbError,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";

/**
 * /api/admin/rewards — 禮品目錄管理（管理員限定）
 *
 * GET  列表 + 可選核銷商戶（merchant_public_list，只回 active）
 * POST { action: "create" | "update", ... } 新增／編輯
 *
 * 硬規則：
 *  - 不提供硬刪除（reward_redemptions.reward_id 是 on delete restrict）。
 *    「刪除」在 UI 一律是 status=inactive（下架），所以這裡沒有 DELETE。
 *  - 庫存只由這支 route 換算；前端送的是「總庫存」，不是剩餘庫存。
 *    create：stock_remaining = stock_total（null = 不限量）
 *    update：used = 舊總量 - 舊剩量（舊總量為 null 時改數已成立的有效兌換）
 *            stock_remaining = max(0, 新總量 - used)
 *  - 回傳格式沿用專案既有 helper：{ok:true,...} / {ok:false,error,code}
 */

type Body = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

export async function GET() {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    const [{ data, error }, { data: merchantRows, error: mErr }] = await Promise.all([
      supabase
        .from("rewards")
        .select(
          "id,name,description,image_path,points_cost,stock_total,stock_remaining,per_user_limit,merchant_id,status,sort_order,created_at,merchant:merchants(id,name)"
        )
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false }),
      supabase.rpc("merchant_public_list"),
    ]);

    if (error) return jsonDbError("GET /api/admin/rewards", error);
    if (mErr) return jsonDbError("GET /api/admin/rewards merchant_public_list", mErr);

    return jsonOk({
      rewards: data ?? [],
      merchants: Array.isArray(merchantRows) ? merchantRows : [],
    });
  } catch (err) {
    return jsonInternal("GET /api/admin/rewards", err);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    const body = (await readJson(request)) as Body | null;
    if (!body) return jsonBadJson();

    const action = text(body.action);
    if (action !== "create" && action !== "update") {
      return jsonValidation({}, "不支援的操作。");
    }

    const id = text(body.id);
    if (action === "update" && !isUuid(id)) {
      return jsonValidation({ id: "禮品編號格式錯誤。" });
    }

    /* ---------- 欄位驗證 ---------- */
    const fields: Record<string, string> = {};

    const name = text(body.name);
    if (name.length < 1 || name.length > 80) fields.name = "請填 1–80 字的名稱。";

    const description = text(body.description);
    if (description.length > 500) fields.description = "說明最多 500 字。";

    const pointsCost = intOrNull(body.points_cost);
    if (pointsCost === null || Number.isNaN(pointsCost) || pointsCost < 0 || pointsCost > 1_000_000) {
      fields.points_cost = "積分價需為 0–1,000,000 的整數。";
    }

    const stockTotal = intOrNull(body.stock_total);
    if (typeof stockTotal === "number" && (Number.isNaN(stockTotal) || stockTotal < 0 || stockTotal > 1_000_000)) {
      fields.stock_total = "總庫存需為 0–1,000,000 的整數，或留空表示不限量。";
    }

    const perUserLimit = intOrNull(body.per_user_limit);
    if (typeof perUserLimit === "number" && (Number.isNaN(perUserLimit) || perUserLimit < 1 || perUserLimit > 1_000_000)) {
      fields.per_user_limit = "每人上限需為 1–1,000,000 的整數，或留空表示不限。";
    }

    const merchantId = text(body.merchant_id);
    if (!isUuid(merchantId)) fields.merchant_id = "請選擇核銷商戶。";

    const sortOrder = intOrNull(body.sort_order);
    if (typeof sortOrder === "number" && (Number.isNaN(sortOrder) || Math.abs(sortOrder) > 9999)) {
      fields.sort_order = "排序需為 -9999–9999 的整數。";
    }

    const status = text(body.status) || "active";
    if (status !== "active" && status !== "inactive") fields.status = "狀態只接受上架或下架。";

    const imagePath = text(body.image_path);
    if (imagePath.length > 300 || (imagePath && imagePath.includes(".."))) {
      fields.image_path = "圖片路徑不正確，請重新上傳。";
    }

    if (Object.keys(fields).length > 0) return jsonValidation(fields);

    /* ---------- 寫入 ---------- */
    if (action === "create") {
      const { data, error } = await supabase
        .from("rewards")
        .insert({
          name,
          description: description || null,
          image_path: imagePath || null,
          points_cost: pointsCost ?? 0,
          stock_total: stockTotal,
          stock_remaining: stockTotal,
          per_user_limit: perUserLimit,
          merchant_id: merchantId,
          status,
          sort_order: sortOrder ?? 0,
        })
        .select("id")
        .single();

      if (error) return jsonDbError("POST /api/admin/rewards insert", error);

      await writeAuditLog(
        supabase,
        actorId,
        "rewards",
        "create",
        `新增禮品「${name}」（${pointsCost} 分）`
      );
      revalidatePath("/admin/rewards");
      revalidatePath("/admin");

      return jsonOk({ id: (data as { id?: string } | null)?.id ?? null, message: "禮品已新增。" });
    }

    /* update：先讀舊列，換算剩餘庫存 */
    const { data: prev, error: prevErr } = await supabase
      .from("rewards")
      .select("id,name,stock_total,stock_remaining")
      .eq("id", id)
      .maybeSingle();

    if (prevErr) return jsonDbError("POST /api/admin/rewards load", prevErr);
    if (!prev) return jsonValidation({ id: "找不到這件禮品，請重新整理。" });

    const oldTotal =
      prev.stock_total === null || prev.stock_total === undefined ? null : Number(prev.stock_total);
    const oldRemaining =
      prev.stock_remaining === null || prev.stock_remaining === undefined
        ? null
        : Number(prev.stock_remaining);

    let used = 0;
    if (oldTotal !== null) {
      used = Math.max(0, oldTotal - (oldRemaining ?? 0));
    } else {
      const { count, error: countErr } = await supabase
        .from("reward_redemptions")
        .select("id", { count: "exact", head: true })
        .eq("reward_id", id)
        .in("status", ["pending", "pending_approval", "completed"]);
      if (countErr) return jsonDbError("POST /api/admin/rewards count", countErr);
      used = count ?? 0;
    }

    const nextRemaining = stockTotal === null ? null : Math.max(0, stockTotal - used);

    const { error } = await supabase
      .from("rewards")
      .update({
        name,
        description: description || null,
        image_path: imagePath || null,
        points_cost: pointsCost ?? 0,
        stock_total: stockTotal,
        stock_remaining: nextRemaining,
        per_user_limit: perUserLimit,
        merchant_id: merchantId,
        status,
        sort_order: sortOrder ?? 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return jsonDbError("POST /api/admin/rewards update", error);

    await writeAuditLog(
      supabase,
      actorId,
      "rewards",
      "update",
      `更新禮品「${name}」（${status === "active" ? "上架" : "下架"}，${pointsCost} 分）`
    );
    revalidatePath("/admin/rewards");
    revalidatePath("/admin");

    return jsonOk({
      message: "禮品已更新。",
      stock_remaining: nextRemaining,
    });
  } catch (err) {
    return jsonInternal("POST /api/admin/rewards", err);
  }
}

/** 不提供硬刪除：有兌換紀錄會被外鍵擋住，請改用「下架」 */
export async function DELETE() {
  return jsonMethodNotAllowed();
}
