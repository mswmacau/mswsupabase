/**
 * /api/admin/members/[id] — 單一會員詳情（管理員限定）
 *
 * GET → RPC admin_get_member
 *     → { ok: true, data: { member, counts, recent_runs, recent_checkins } }
 *
 * 契約：
 *  - 鑑權與錯誤信封复刻 /api/admin/site-content（authorizeAdmin + lib/api）
 *  - 詳情一律走 security definer RPC（RLS 只有「本人可更新」，管理員讀他人
 *    的完整資料需要函式），見 supabase/migration-admin-members-v2.sql
 *  - member 以「列表列」形狀回傳（member_id + run_count/checkin_count/coupon_count），
 *    讓前端抽屜與列表共用同一組欄位名
 *  - 查無資料 → 404；非管理員 → 403；未登入 → 401
 *
 * H6：全部包 try/catch，任何情況都回 JSON。
 */

import { createClient } from "@/lib/supabase/server";
import { assertModuleAccess } from "@/lib/admin-guard";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isUuid,
  jsonForbidden,
  jsonInternal,
  jsonNotConfigured,
  jsonNotFound,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
} from "@/lib/api";

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
  /**
   * 管理員級別（supabase/migration-admin-levels.sql）：1=最高級、2=第二級、null=非管理員。
   * **刻意保留 undefined 的語意**：undefined = 該欄位不存在（migration 未跑），
   * null = 有這一欄但值為空。前端（MemberDrawer）靠這個區分「未跑 migration」
   * 與「未分級」，所以這裡不能寫 `?? null`（那會把兩者混為一談）。
   */
  admin_level?: 1 | 2 | null;
  created_at: string;
  last_sign_in_at: string | null;
  run_count: number | string;
  checkin_count: number | string;
  coupon_count: number | string;
};

type MemberDetail = {
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  role: MemberRow["role"];
  admin_level?: 1 | 2 | null;
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

/** 與 /api/admin/members 的列表列對齊（id → member_id，counts 攤平） */
function toMemberRow(detail: MemberDetail): MemberRow {
  const counts = detail.counts ?? {};
  return {
    member_id: detail.id,
    display_name: detail.display_name,
    email: detail.email,
    phone: detail.phone,
    role: detail.role,
    // 透傳，不做 ?? null：undefined（migration 未跑）與 null（未分級）是兩件事
    admin_level: detail.admin_level,
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

/** Supabase 設定檢查 → 未登入 401 → 非管理員 403（复刻 site-content） */
async function authorizeAdmin(opts: { write?: boolean } = {}) {
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

  const denied = await assertModuleAccess(supabase, "members", opts);
  if (denied) return { res: denied } as const;

  return { supabase } as const;
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authorizeAdmin();
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const { id } = await ctx.params;
    const memberId = (id ?? "").trim();
    if (!isUuid(memberId)) {
      return jsonValidation({ id: "會員編號格式錯誤。" });
    }

    const { data, error } = await supabase.rpc("admin_get_member", {
      p_id: memberId,
    });

    if (error) {
      if (error.code === "P0001" && /找不到|不存在/.test(error.message ?? "")) {
        return jsonNotFound("找不到這位會員。");
      }
      if (error.code === "P0001") {
        return jsonValidation({}, error.message ?? "操作被拒絕。");
      }
      return jsonInternal("GET /api/admin/members/[id] rpc", error);
    }

    const detail = (data ?? null) as MemberDetail | null;
    if (!detail) return jsonNotFound("找不到這位會員。");

    return jsonOk({
      data: {
        member: toMemberRow(detail),
        counts: detail.counts ?? {},
        recent_runs: detail.recent_runs ?? [],
        recent_checkins: detail.recent_checkins ?? [],
      },
    });
  } catch (err) {
    return jsonInternal("GET /api/admin/members/[id]", err);
  }
}
