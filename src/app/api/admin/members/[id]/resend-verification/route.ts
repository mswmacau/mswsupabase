/**
 * /api/admin/members/[id]/resend-verification — 重寄會員驗證信（管理員限定）
 *
 * POST {}（不需要 body）
 *  1. 先以一般 client（anon key + 管理員 session）呼叫 supabase.auth.resend
 *     成功 → { ok:true, data:{ sent:true } }（真的寄出，走站台 SMTP）
 *  2. 失敗（常見：SMTP 未設定、速率限制）且有 service_role →
 *     fallback auth.admin.generateLink({ type:'signup' })
 *     → { ok:true, data:{ sent:false, action_link, note } }（電郵未寄出，改為人工轉交）
 *  3. 兩者都失敗 → 400 { ok:false, error:'無法寄出驗證信：<原始訊息>（可能未設定 SMTP）' }
 *
 * 契約：
 *  - 鑑權與錯誤信封复刻 /api/admin/members（authorizeAdmin + lib/api）
 *  - email 只能從 RPC admin_get_member 取得（profiles 沒有 email 欄）
 *  - 會員不存在 → 404
 *  - action_link 只出現在 HTTP 回應：不寫入稽核摘要、不寫 console
 *    （稽核 action=resend_verification，摘要只寫會員名稱與「有沒有真的寄出」）
 *
 * H6：全部包 try/catch，任何情況都回 JSON。
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createAdminClient, isServiceRoleConfigured } from "@/lib/supabase/admin";
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
import { writeAuditLog } from "@/lib/audit";

type MemberDetail = {
  id: string;
  display_name: string | null;
  email: string | null;
};

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://msw-street-workout.vercel.app"
).replace(/\/+$/, "");

/** 400：寄不出驗證信（一律 JSON，附原始訊息方便管理員判斷是否為 SMTP 問題） */
function jsonResendFailed(reason: string) {
  return NextResponse.json(
    { ok: false, error: `無法寄出驗證信：${reason}（可能未設定 SMTP）` },
    { status: 400 }
  );
}

/** Supabase 設定檢查 → 未登入 401 → 非管理員 403（复刻 /api/admin/members） */
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

/**
 * generateLink 的 public 型別（GenerateSignupLinkParams）把 password 列為必填，
 * 但那只在「順便建立新使用者」時才用到；這裡對象是既有帳號，只需要驗證連結，
 * 帶一個假密碼反而有覆寫會員密碼的風險，因此以窄型別傳參、不帶 password。
 */
type SignupLinkParams = {
  type: "signup";
  email: string;
  options: { redirectTo: string };
};

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authorizeAdmin();
    if ("res" in auth) return auth.res;
    const { supabase, actorId } = auth;

    const { id } = await ctx.params;
    const memberId = (id ?? "").trim();
    if (!isUuid(memberId)) {
      return jsonValidation({ id: "會員編號格式錯誤。" });
    }

    /* ---------- 會員 + email（profiles 沒有 email 欄，只能走 RPC） ---------- */
    const { data: detail, error: detailError } = await supabase.rpc(
      "admin_get_member",
      { p_id: memberId }
    );
    if (detailError) {
      if (
        detailError.code === "P0001" &&
        /找不到|不存在/.test(detailError.message ?? "")
      ) {
        return jsonNotFound("找不到這位會員。");
      }
      return jsonInternal(
        "POST /api/admin/members/[id]/resend-verification rpc",
        detailError
      );
    }

    const member = (detail ?? null) as MemberDetail | null;
    if (!member) return jsonNotFound("找不到這位會員。");

    const email = (member.email ?? "").trim();
    if (!email) {
      return jsonValidation({}, "此會員沒有電郵地址，無法寄出驗證信。");
    }
    const memberName = member.display_name || email;

    /* ---------- 1. 一般 client 請 Supabase 走站台 SMTP 重寄 ---------- */
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email,
    });

    if (!resendError) {
      await writeAuditLog(
        supabase,
        actorId,
        "members",
        "resend_verification",
        `為 ${memberName} 重寄驗證信。`
      );
      return jsonOk({
        data: { sent: true },
        message: "已重寄驗證信，請提醒會員到信箱（含垃圾郵件）查看。",
      });
    }

    const resendMessage = resendError.message || "未知錯誤";

    /* ---------- 2. 寄不出去：有 service_role 就產生連結，交由管理員人工轉交 ---------- */
    if (!isServiceRoleConfigured) return jsonResendFailed(resendMessage);

    const adminClient = createAdminClient();
    const params: SignupLinkParams = {
      type: "signup",
      email,
      options: { redirectTo: `${SITE_URL}/login` },
    };
    const { data: linkData, error: linkError } =
      await adminClient.auth.admin.generateLink(
        params as unknown as Parameters<
          typeof adminClient.auth.admin.generateLink
        >[0]
      );

    const actionLink = linkError
      ? ""
      : (linkData?.properties?.action_link ?? "");

    if (linkError || !actionLink) {
      return jsonResendFailed(linkError?.message || resendMessage);
    }

    await writeAuditLog(
      supabase,
      actorId,
      "members",
      "resend_verification",
      `為 ${memberName} 產生驗證連結（電郵未寄出，連結由管理員人工轉交）。`
    );

    return jsonOk({
      data: {
        sent: false,
        action_link: actionLink,
        note: "電郵未寄出，已產生驗證連結，請手動發送給會員。",
      },
      message: "電郵未寄出，已改為產生驗證連結。",
    });
  } catch (err) {
    return jsonInternal("POST /api/admin/members/[id]/resend-verification", err);
  }
}
