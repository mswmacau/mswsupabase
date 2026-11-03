import { revalidatePath } from "next/cache";
import { authorizeAdmin } from "@/lib/admin-guard";
import {
  isUuid,
  jsonBadJson,
  jsonConflict,
  jsonDbError,
  jsonErr,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";

/**
 * /api/admin/redemptions — 兌換紀錄（電子券）管理（管理員限定）
 *
 * GET  ?status=all|pending_approval|pending|completed|cancelled&q=&limit=
 *      回列表 + 各狀態總數（供篩選頁籤顯示）。
 * POST { action:"review", id, decision:"approved"|"rejected" }
 *      { action:"fulfill", id, outcome:"completed"|"cancelled" }
 *
 * 金額、退款、回庫存全部由 RPC 在單一交易內處理，這支 route 只驗身分／格式，
 * 並把 RPC 的錯誤碼翻成繁中句子。RPC 自己會寫 admin_audit_log（module=redemptions）。
 */

type Body = Record<string, unknown>;

const STATUSES = ["pending_approval", "pending", "completed", "cancelled"] as const;
type StatusKey = (typeof STATUSES)[number];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type RpcResult = {
  ok?: boolean;
  code?: string;
  status?: string;
  detail?: string;
  skipped?: boolean;
  reason?: string;
};

/** RPC 業務錯誤 → HTTP + 中文句子 */
function rpcFailure(result: RpcResult | null, fallback: string) {
  const code = result?.code ?? "UNKNOWN";
  if (code === "NOT_ADMIN") return jsonErr("權限不足。", "FORBIDDEN", 403);
  if (code === "NOT_FOUND") return jsonNotFound("找不到這張券，可能已被刪除。");
  if (code === "INVALID_STATUS") {
    return jsonConflict(
      `這張券的狀態已改變（目前：${statusLabel(result?.status ?? "")}），請重新整理後再試。`
    );
  }
  if (code === "INVALID_ARGUMENT") return jsonErr(fallback, "VALIDATION", 400);
  return jsonErr(fallback, "INTERNAL", 500);
}

function statusLabel(status: string): string {
  switch (status) {
    case "pending_approval":
      return "待審批";
    case "pending":
      return "待領取";
    case "completed":
      return "已完成";
    case "cancelled":
      return "已取消";
    default:
      return status || "未知";
  }
}

export async function GET(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    const url = new URL(request.url);
    const statusParam = text(url.searchParams.get("status")) || "all";
    const q = text(url.searchParams.get("q"));
    const limitRaw = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 100;

    const status = (STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as StatusKey)
      : null;

    /* 搜尋：券碼 like，或先用會員名找出 user_id（避免依賴 embedded or filter） */
    let matchedUserIds: string[] = [];
    if (q) {
      const { data: profiles, error: pErr } = await supabase
        .from("profiles")
        .select("id")
        .ilike("display_name", `%${q}%`)
        .limit(50);
      if (pErr) return jsonDbError("GET /api/admin/redemptions profiles", pErr);
      matchedUserIds = (profiles ?? []).map((r) => (r as { id: string }).id);
    }

    let query = supabase
      .from("reward_redemptions")
      .select(
        `id,pickup_code,status,points_spent,created_at,decided_at,merchant_verified_at,expires_at,note,redeemed_via,
         user:profiles!user_id(id,display_name,created_at),
         reward:rewards(id,name),
         merchant:merchants(id,name)`,
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);
    if (q) {
      const escaped = q.replace(/[(),]/g, " ");
      query = matchedUserIds.length
        ? query.or(`pickup_code.ilike.%${escaped}%,user_id.in.(${matchedUserIds.join(",")})`)
        : query.ilike("pickup_code", `%${escaped}%`);
    }

    const { data, error, count } = await query;
    if (error) return jsonDbError("GET /api/admin/redemptions", error);

    /* 各狀態總數（小查詢；供頁籤上的數字） */
    const countQueries = await Promise.all([
      supabase.from("reward_redemptions").select("id", { count: "exact", head: true }),
      ...STATUSES.map((s) =>
        supabase
          .from("reward_redemptions")
          .select("id", { count: "exact", head: true })
          .eq("status", s)
      ),
    ]);

    const counts: Record<string, number> = { all: countQueries[0].count ?? 0 };
    STATUSES.forEach((s, index) => {
      counts[s] = countQueries[index + 1].count ?? 0;
    });

    return jsonOk({
      redemptions: data ?? [],
      total: count ?? 0,
      counts,
    });
  } catch (err) {
    return jsonInternal("GET /api/admin/redemptions", err);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    const body = (await readJson(request)) as Body | null;
    if (!body) return jsonBadJson();

    const action = text(body.action);
    const id = text(body.id);
    if (!isUuid(id)) return jsonValidation({ id: "券編號格式錯誤。" });

    if (action === "review") {
      const decision = text(body.decision);
      if (decision !== "approved" && decision !== "rejected") {
        return jsonValidation({ decision: "只接受批准或拒絕。" });
      }

      const { data, error } = await supabase.rpc("admin_review_redemption", {
        p_id: id,
        p_decision: decision,
      });

      if (error) {
        if (error.code === "PGRST202") {
          return jsonErr("兌換審批功能暫未部署。", "SCHEMA_OUTDATED", 503);
        }
        return jsonDbError("POST /api/admin/redemptions review", error);
      }

      const result = (Array.isArray(data) ? data[0] : data) as RpcResult | null;
      if (!result?.ok) return rpcFailure(result, "審批失敗，請重新整理後再試。");

      revalidatePath("/admin/redemptions");
      revalidatePath("/admin");
      revalidatePath("/dashboard");

      return jsonOk({
        status: result.status ?? (decision === "approved" ? "pending" : "cancelled"),
        message:
          decision === "approved"
            ? "已批准，券已轉為「待領取」。"
            : "已拒絕，積分已退回並回補庫存。",
      });
    }

    if (action === "fulfill") {
      const outcome = text(body.outcome);
      if (outcome !== "completed" && outcome !== "cancelled") {
        return jsonValidation({ outcome: "只接受標記已領取或取消。" });
      }

      const { data, error } = await supabase.rpc("admin_fulfill_redemption", {
        p_id: id,
        p_action: outcome,
      });

      if (error) {
        if (error.code === "PGRST202") {
          return jsonErr("後備核銷功能暫未部署。", "SCHEMA_OUTDATED", 503);
        }
        return jsonDbError("POST /api/admin/redemptions fulfill", error);
      }

      const result = (Array.isArray(data) ? data[0] : data) as RpcResult | null;
      if (!result?.ok) return rpcFailure(result, "核銷失敗，請重新整理後再試。");

      revalidatePath("/admin/redemptions");
      revalidatePath("/admin");
      revalidatePath("/dashboard");

      return jsonOk({
        status: result.status ?? outcome,
        message:
          outcome === "completed"
            ? "已標記為已領取。"
            : "已取消，積分已退回並回補庫存。",
      });
    }

    return jsonValidation({}, "不支援的操作。");
  } catch (err) {
    return jsonInternal("POST /api/admin/redemptions", err);
  }
}

export async function DELETE() {
  return jsonMethodNotAllowed();
}
