/**
 * /api/admin/members — 會員管理（管理員限定，v2 完整 CRUD）
 *
 * GET    ?q=&role=&status=&page=&limit=
 *        → RPC admin_list_members
 *        → { ok: true, data: { members, total, page, limit, has_service_role } }
 * POST   { email, password, display_name?, role? }   → 建立帳號（需 service_role）
 * PATCH  { userId, display_name?, phone?, role?, status?, status_reason? }
 *        → RPC admin_update_member
 * DELETE ?userId=  → 有 service_role：auth.admin.deleteUser + admin_delete_member
 *                    沒有：軟刪除（status='disabled'），回應帶 note
 *
 * 契約：
 *  - 鑑權與錯誤信封复刻 /api/admin/site-content（authorizeAdmin + lib/api）
 *  - RLS 只有「本人可更新」政策，管理員改他人列一律走 security definer RPC
 *    （見 supabase/migration-admin-members-v2.sql）
 *  - RPC 以 P0001 raise 的業務規則錯誤 → 400（找不到 → 404）
 *  - 建立／刪除 auth 使用者需要 service_role；本站只有 anon key，
 *    未配置 SUPABASE_SERVICE_ROLE_KEY 時：
 *      POST   → 501 SERVICE_ROLE_REQUIRED（不可假裝成功）
 *      DELETE → 只把 status 設為 'disabled'（軟刪除），並在回應說明
 *  - 成功後寫一筆 admin_audit_log（module=members，
 *    action=create/update/delete/soft_delete；best-effort，見 src/lib/audit.ts）
 *
 * H6：全部包 try/catch，任何情況都回 JSON，不讓例外裸奔成 HTML 500。
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createAdminClient, isServiceRoleConfigured } from "@/lib/supabase/admin";
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
  phone?: string | null;
  role: "member" | "admin";
  status: "active" | "suspended" | "disabled";
  status_reason: string | null;
  points: number;
  total_km: number | string;
  created_at: string;
  last_sign_in_at: string | null;
  run_count: number | string;
  checkin_count: number | string;
  coupon_count: number | string;
  total_count?: number | string;
};

/** admin_get_member 回傳的 jsonb 形狀 */
type MemberDetail = {
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  role: MemberRow["role"];
  status: MemberRow["status"];
  status_reason: string | null;
  status_updated_at: string | null;
  points: number;
  total_km: number | string;
  created_at: string;
  last_sign_in_at: string | null;
  counts?: Record<string, number | string | null>;
  recent_runs?: unknown[];
  recent_checkins?: unknown[];
};

type RpcError = { code?: string | null; message?: string | null };

const ROLES = ["member", "admin"] as const;
const STATUSES = ["active", "suspended", "disabled"] as const;

type Role = (typeof ROLES)[number];
type MemberStatus = (typeof STATUSES)[number];

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

/** 501：需要 service_role 但沒配置（不可假裝成功） */
function jsonServiceRoleRequired(
  error = "未設定 SUPABASE_SERVICE_ROLE_KEY，無法新增帳號。"
) {
  return NextResponse.json(
    { ok: false, code: "SERVICE_ROLE_REQUIRED", error },
    { status: 501 }
  );
}

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

/** 合法角色 → 正規化值；不合法／缺值 → null */
function parseRole(raw: unknown): Role | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return (ROLES as readonly string[]).includes(v) ? (v as Role) : null;
}

/** 合法狀態 → 正規化值；不合法／缺值 → null */
function parseStatus(raw: unknown): MemberStatus | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return (STATUSES as readonly string[]).includes(v) ? (v as MemberStatus) : null;
}

/** 可為 null 的字串欄位：undefined／null → null；其餘 trim 並截斷 */
function optionalText(raw: unknown, max = 80): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v === "") return null;
  return v.slice(0, max);
}

/**
 * 更新用的字串欄位：只有「非字串／undefined」才算 null（= 不改）；
 * 空字串要保留，RPC 會把它當成「清空這一欄」。
 * （若沿用 optionalText，管理員就永遠清不掉會員的顯示名稱。）
 */
function textOrNull(raw: unknown, max = 80): string | null {
  if (typeof raw !== "string") return null;
  return raw.trim().slice(0, max);
}

/**
 * 把 admin_get_member 的 jsonb 攤平成「列表列」格式：
 * 前端會員列表／編輯對話框都用 member_id + run_count/checkin_count/coupon_count，
 * 直接在 API 這一層對齊，避免前端要記兩套欄位名（id vs member_id）。
 */
function toMemberRow(detail: MemberDetail): MemberRow {
  const counts = detail.counts ?? {};
  return {
    member_id: detail.id,
    display_name: detail.display_name,
    email: detail.email,
    phone: detail.phone,
    role: detail.role,
    status: detail.status,
    status_reason: detail.status_reason,
    points: Number(detail.points ?? 0),
    total_km: detail.total_km ?? 0,
    created_at: detail.created_at,
    last_sign_in_at: detail.last_sign_in_at,
    run_count: Number(counts.run_count ?? 0),
    checkin_count: Number(counts.checkin_count ?? 0),
    coupon_count: Number(counts.coupon_count ?? 0),
  };
}

/* =============================================================
 * GET — 會員列表（搜尋 / 篩選 / 分頁）
 * ============================================================= */
export async function GET(request: Request) {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const url = new URL(request.url);
    const search = optionalText(url.searchParams.get("q"), 80);

    // 篩選值非法時視同「不篩選」（與 RPC 行為一致，不因舊前端 crash）
    const role = parseRole(url.searchParams.get("role"));
    const status = parseStatus(url.searchParams.get("status"));

    const page = parseIntParam(url.searchParams.get("page"), 1, 1, 1_000_000);
    const limit = parseIntParam(url.searchParams.get("limit"), 20, 1, 100);
    const offset = (page - 1) * limit;

    const { data, error } = await supabase.rpc("admin_list_members", {
      p_search: search,
      p_role: role,
      p_status: status,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) return rpcFailure("GET /api/admin/members rpc", error);

    const rows = (Array.isArray(data) ? data : []) as MemberRow[];

    // total_count 是 count(*) over() 的分頁總數；只取第一列，並從成員物件移除
    const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
    const members: MemberRow[] = rows.map((row) => {
      const member = { ...row };
      delete member.total_count;
      return member;
    });

    return jsonOk({
      data: {
        members,
        total,
        page,
        limit,
        has_service_role: isServiceRoleConfigured,
      },
    });
  } catch (err) {
    return jsonInternal("GET /api/admin/members", err);
  }
}

/* =============================================================
 * POST — 建立會員帳號（需 service_role）
 * ============================================================= */
export async function POST(request: Request) {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, actorId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const displayName = optionalText(body.display_name, 80);
    const roleRaw = body.role;
    const role = parseRole(roleRaw) ?? "member";

    const fields: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fields.email = "請輸入有效的電郵地址。";
    }
    if (password.length < 8) {
      fields.password = "密碼至少 8 個字元。";
    }
    if (roleRaw !== undefined && roleRaw !== null && parseRole(roleRaw) === null) {
      fields.role = "角色只能是 member 或 admin。";
    }
    if (Object.keys(fields).length > 0) return jsonValidation(fields);

    // 沒有 service_role 就無法建立 auth 使用者 —— 明確拒絕，不回假成功
    if (!isServiceRoleConfigured) return jsonServiceRoleRequired();

    const adminClient = createAdminClient();

    const { data: created, error: createError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: displayName ? { display_name: displayName } : {},
      });

    if (createError) {
      const msg = createError.message ?? "";
      if (
        createError.code === "email_exists" ||
        /already (been )?registered|already exists|duplicate/i.test(msg)
      ) {
        return jsonValidation({ email: "此電郵已被註冊，請改用其他電郵。" });
      }
      return jsonInternal("POST /api/admin/members createUser", createError);
    }

    const newUserId = created.user?.id;
    if (!newUserId) {
      return jsonInternal("POST /api/admin/members createUser", {
        message: "createUser 沒有回傳 user.id",
      });
    }

    // 觸發器 handle_new_user 已用 user_metadata.display_name 建好 member 列；
    // 這裡補上最終的 display_name / role（service_role 會 bypass RLS，
    // auth.uid() 為 null 時 guard 觸發器直接放行）。
    const { error: profileError } = await adminClient
      .from("profiles")
      .update({
        ...(displayName ? { display_name: displayName } : {}),
        role,
      })
      .eq("id", newUserId);

    if (profileError) {
      // 帳號已建立但 profile 補充失敗：回 500 並留下 log，交由人工補正
      return jsonInternal("POST /api/admin/members update profile", profileError);
    }

    await writeAuditLog(
      supabase,
      actorId,
      "members",
      "create",
      `新增會員 ${email}${role === "admin" ? "（管理員）" : ""}。`
    );

    return jsonOk({
      data: {
        member: {
          member_id: newUserId,
          id: newUserId,
          email,
          display_name: displayName,
          role,
          status: "active",
        },
      },
      message: "已新增會員帳號。",
    });
  } catch (err) {
    return jsonInternal("POST /api/admin/members", err);
  }
}

/* =============================================================
 * PATCH — 更新會員資料 / 角色 / 狀態
 * ============================================================= */
export async function PATCH(request: Request) {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, actorId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (!isUuid(userId)) {
      return jsonValidation({ userId: "會員編號格式錯誤。" });
    }

    const fields: Record<string, string> = {};
    const roleRaw = body.role;
    const statusRaw = body.status;
    const role = parseRole(roleRaw);
    const status = parseStatus(statusRaw);

    if (roleRaw !== undefined && roleRaw !== null && role === null) {
      fields.role = "角色只能是 member 或 admin。";
    }
    if (statusRaw !== undefined && statusRaw !== null && status === null) {
      fields.status = "狀態只能是 active、suspended 或 disabled。";
    }
    if (Object.keys(fields).length > 0) return jsonValidation(fields);

    const displayName = textOrNull(body.display_name, 80);
    const phone = textOrNull(body.phone, 30);
    const statusReason = textOrNull(body.status_reason, 200);

    const { error } = await supabase.rpc("admin_update_member", {
      p_id: userId,
      p_display_name: displayName,
      p_phone: phone,
      p_role: role,
      p_status: status,
      p_status_reason: statusReason,
    });
    if (error) return rpcFailure("PATCH /api/admin/members rpc", error);

    const changes: string[] = [];
    if (displayName !== null) changes.push("名稱");
    if (phone !== null) changes.push("電話");
    if (role !== null) changes.push(`角色=${role}`);
    if (status !== null) {
      changes.push(`狀態=${status}`);
      if (statusReason) changes.push(`原因：${statusReason}`);
    }

    await writeAuditLog(
      supabase,
      actorId,
      "members",
      "update",
      `更新會員 ${userId}${changes.length ? `（${changes.join("、")}）` : ""}。`
    );

    // 回傳「列表列」形狀（含三個計數與 email），前端才能直接覆蓋原本那一列。
    // admin_get_member 失敗時退回 null，由前端用本地狀態補上，不讓更新變失敗。
    const { data: detail, error: detailError } = await supabase.rpc(
      "admin_get_member",
      { p_id: userId }
    );
    const member =
      !detailError && detail ? toMemberRow(detail as MemberDetail) : null;

    return jsonOk({ data: { member }, message: "已更新會員資料。" });
  } catch (err) {
    return jsonInternal("PATCH /api/admin/members", err);
  }
}

/* =============================================================
 * DELETE — 刪除會員（有 service_role 真刪，沒有則軟刪除）
 * ============================================================= */
export async function DELETE(request: Request) {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, actorId } = auth;

    const url = new URL(request.url);
    const userId = (url.searchParams.get("userId") ?? "").trim();
    if (!isUuid(userId)) {
      return jsonValidation({ userId: "會員編號格式錯誤。" });
    }
    if (userId === actorId) {
      return jsonValidation({ userId: "不可刪除自己的帳號。" }, "不可刪除自己的帳號。");
    }

    // 先讀目標角色：admin 需確認不是最後一位（RPC 也會擋，這裡先給清楚的錯誤）
    const { data: target, error: targetError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    if (targetError) return jsonInternal("DELETE /api/admin/members read", targetError);
    if (!target) return jsonNotFound("找不到這位會員。");

    if (target.role === "admin") {
      const { count, error: countError } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");
      if (countError) {
        return jsonInternal("DELETE /api/admin/members count admins", countError);
      }
      if ((count ?? 0) <= 1) {
        return jsonValidation(
          { userId: "至少要保留一位管理員。" },
          "至少要保留一位管理員。"
        );
      }
    }

    /* ---------- 沒有 service_role：只能軟刪除 ---------- */
    if (!isServiceRoleConfigured) {
      const { data, error } = await supabase.rpc("admin_update_member", {
        p_id: userId,
        p_display_name: null,
        p_phone: null,
        p_role: null,
        p_status: "disabled",
        p_status_reason: "後台刪除（未設定 service_role，僅停用）",
      });
      if (error) return rpcFailure("DELETE /api/admin/members soft delete", error);

      await writeAuditLog(
        supabase,
        actorId,
        "members",
        "soft_delete",
        `停用會員 ${userId}（未設定 SUPABASE_SERVICE_ROLE_KEY，僅軟刪除）。`
      );

      return jsonOk({
        data: { soft_deleted: true, member: data },
        note: "未設定 SUPABASE_SERVICE_ROLE_KEY，僅將帳號設為停用（status=disabled）；登入憑證仍存在，需在 Supabase 後台手動刪除 auth 使用者。",
        message: "已停用會員帳號。",
      });
    }

    /* ---------- 有 service_role：先刪 auth 使用者，再清 profile ---------- */
    const adminClient = createAdminClient();
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);

    // auth 使用者早已不存在（例如先前只刪了 profile）→ 視為可修復的孤兒資料，
    // 繼續往下讓 RPC 把殘留的 profile 清掉；其餘錯誤才回 500。
    const authUserMissing =
      !!deleteError && /not\s*found|user not found/i.test(deleteError.message ?? "");

    if (deleteError && !authUserMissing) {
      return jsonInternal("DELETE /api/admin/members deleteUser", deleteError);
    }

    // auth.users 刪除後 profiles 會 on delete cascade 一併消失，
    // 此時 RPC 會 raise「找不到這位會員」——這是正常結果，不視為失敗。
    // （RPC 僅作為最後一道守門，真正的保護在呼叫前已檢查過。）
    const { error: rpcError } = await supabase.rpc("admin_delete_member", {
      p_id: userId,
    });
    if (rpcError && !/找不到/.test(rpcError.message ?? "")) {
      return rpcFailure("DELETE /api/admin/members rpc", rpcError);
    }

    await writeAuditLog(
      supabase,
      actorId,
      "members",
      "delete",
      `刪除會員 ${userId}（含 auth 使用者）。`
    );

    return jsonOk({ data: { deleted: true }, message: "已刪除會員帳號。" });
  } catch (err) {
    return jsonInternal("DELETE /api/admin/members", err);
  }
}
