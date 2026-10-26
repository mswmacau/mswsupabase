/**
 * /api/admin/members — 會員管理（管理員限定）
 *
 * GET  ?q=&limit=&offset=  → RPC admin_list_members
 *      → { ok: true, data: { members: [...] } }
 * POST { action: 'set_role', userId, role }
 *      { action: 'adjust_points', userId, delta, reason? }
 *      → { ok: true, data, message }
 *
 * 契約：
 *  - 鑑權與錯誤信封复刻 /api/admin/site-content（authorizeAdmin + lib/api）
 *  - RLS 只有「本人可更新」政策，管理員改他人列一律走 security definer RPC
 *    （見 supabase/migration-admin-members.sql）
 *  - RPC 以 P0001 raise 的業務規則錯誤 → 400（找不到 → 404）
 *  - 成功後寫一筆 admin_audit_log（module=members，
 *    action=set_role / adjust_points；best-effort，見 src/lib/audit.ts）
 *
 * H6：全部包 try/catch，任何情況都回 JSON，不讓例外裸奔成 HTML 500。
 */

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isUuid,
  jsonBadJson,
  jsonForbidden,
  jsonInternal,
  jsonNotFound,
  jsonNotConfigured,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

type MemberRow = {
  member_id: string;
  display_name: string | null;
  email: string | null;
  role: "member" | "admin";
  points: number;
  total_km: number | string;
  created_at: string;
  last_sign_in_at: string | null;
  run_count: number | string;
  checkin_count: number | string;
  coupon_count: number | string;
};

type RpcError = { code?: string | null; message?: string | null };

/** Supabase 設定檢查 → 未登入 401 → 非管理員 403（复刻 site-content） */
async function authorizeAdmin() {
  if (!isSupabaseConfigured) return { res: jsonNotConfigured() } as const;

  const supabase = await createClient();
  if (!supabase) return { res: jsonNotConfigured() } as const;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { res: jsonUnauthenticated() } as const;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { res: jsonForbidden() } as const;

  return { supabase, actorId: user.id } as const;
}

type Authorized = Awaited<ReturnType<typeof authorizeAdmin>>;

/**
 * RPC 錯誤對映：
 * - P0001 + 「找不到／不存在」→ 404
 * - 其餘 P0001（業務規則，例如「至少要保留一位管理員」）→ 400，訊息直接顯示
 * - 其他 → 500（真實錯誤只寫 server log）
 */
function rpcFailure(where: string, error: RpcError) {
  if (error?.code === "P0001") {
    const message = error.message ?? "";
    if (/找不到|不存在/.test(message)) {
      return jsonNotFound(message || "找不到這筆資料。");
    }
    return jsonValidation({}, message || "操作被拒絕。");
  }
  return jsonInternal(where, error);
}

/** 解析整數 query 參數；缺值或非數字用預設值，並夾在 [min, max] */
function parseIntParam(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/* =============================================================
 * GET — 會員列表
 * ============================================================= */
export async function GET(request: Request) {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const url = new URL(request.url);
    const search = (url.searchParams.get("q") ?? "").trim();
    const limit = parseIntParam(url.searchParams.get("limit"), 50, 1, 200);
    const offset = parseIntParam(
      url.searchParams.get("offset"),
      0,
      0,
      1_000_000
    );

    const { data, error } = await supabase.rpc("admin_list_members", {
      p_search: search || null,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) return rpcFailure("GET /api/admin/members rpc", error);

    const members = (Array.isArray(data) ? data : []) as MemberRow[];
    return jsonOk({ data: { members } });
  } catch (err) {
    return jsonInternal("GET /api/admin/members", err);
  }
}

/* =============================================================
 * POST — set_role / adjust_points
 * ============================================================= */
export async function POST(request: Request) {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, actorId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const action = typeof body.action === "string" ? body.action.trim() : "";

    /* ---------- 調整角色 ---------- */
    if (action === "set_role") {
      const userId = typeof body.userId === "string" ? body.userId.trim() : "";
      const role = typeof body.role === "string" ? body.role.trim() : "";

      if (!isUuid(userId)) {
        return jsonValidation({ userId: "會員編號格式錯誤。" });
      }
      if (role !== "member" && role !== "admin") {
        return jsonValidation({ role: "角色只能是 member 或 admin。" });
      }

      const { data, error } = await supabase.rpc("admin_set_member_role", {
        p_user_id: userId,
        p_role: role,
      });
      if (error) return rpcFailure("POST /api/admin/members set_role", error);

      const member = (Array.isArray(data) ? data[0] : data) as
        | MemberRow
        | null;

      // T-15 操作日誌（best-effort，失敗不影響回應）
      await writeAuditLog(
        supabase,
        actorId,
        "members",
        "set_role",
        `將會員 ${userId} 的角色改為 ${role}。`
      );

      return jsonOk({ data: { member }, message: "已更新會員角色。" });
    }

    /* ---------- 調整積分 ---------- */
    if (action === "adjust_points") {
      const userId = typeof body.userId === "string" ? body.userId.trim() : "";
      const delta = typeof body.delta === "number" ? body.delta : Number(body.delta);
      const reason =
        typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";

      if (!isUuid(userId)) {
        return jsonValidation({ userId: "會員編號格式錯誤。" });
      }
      if (!Number.isInteger(delta) || delta === 0) {
        return jsonValidation({ delta: "請輸入非 0 的整數。" });
      }

      const { data, error } = await supabase.rpc("admin_adjust_points", {
        p_user_id: userId,
        p_delta: delta,
        p_reason: reason || null,
      });
      if (error) return rpcFailure("POST /api/admin/members adjust_points", error);

      const points = Number(data);

      // T-15 操作日誌（best-effort，失敗不影響回應）
      await writeAuditLog(
        supabase,
        actorId,
        "members",
        "adjust_points",
        `調整會員 ${userId} 積分 ${delta > 0 ? "+" : ""}${delta}${
          reason ? `（${reason}）` : ""
        }。`
      );

      return jsonOk({
        data: { points },
        message: `已調整積分，目前 ${points} 分。`,
      });
    }

    return jsonValidation({ action: "不支援的操作。" }, "不支援的操作。");
  } catch (err) {
    return jsonInternal("POST /api/admin/members", err);
  }
}
