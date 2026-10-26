/**
 * /api/admin/members/[id]/reset-password — 重設會員密碼（管理員限定）
 *
 * POST { mode: 'temp' | 'link' }
 *  - temp → 產生 12 字元臨時密碼並立即套用（auth.admin.updateUserById）
 *           → { ok:true, data:{ mode:'temp', email, password } }
 *  - link → 產生一次性密碼重設連結（auth.admin.generateLink type=recovery）
 *           → { ok:true, data:{ mode:'link', email, action_link } }
 *
 * 契約：
 *  - 鑑權與錯誤信封复刻 /api/admin/members（authorizeAdmin + lib/api）
 *  - 會員資料（含 email）走 security definer RPC admin_get_member：
 *    profiles 沒有 email 欄，email 存在 auth.users，一般 select 讀不到
 *  - 兩種模式都動 auth.users，需 service_role；未配置 → 501 SERVICE_ROLE_REQUIRED
 *  - 會員不存在（profiles 無此列）→ 404
 *  - auth.users 已無此使用者（孤兒 profile）→ 400，中文說明請重建帳號
 *  - 密碼/連結只出現在 HTTP 回應：不寫入稽核摘要、不寫 console
 *    （稽核 action=reset_password_temp / reset_password_link，摘要只寫會員名稱）
 *
 * H6：全部包 try/catch，任何情況都回 JSON，不讓例外裸奔成 HTML 500。
 */

import { randomInt } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createAdminClient, isServiceRoleConfigured } from "@/lib/supabase/admin";
import {
  isUuid,
  jsonBadJson,
  jsonForbidden,
  jsonInternal,
  jsonNotConfigured,
  jsonNotFound,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
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

/** 排除 0/O/1/l/I 等易混淆字元，仍同時含大寫、小寫、數字 */
const PASSWORD_POOLS = [
  "ABCDEFGHJKLMNPQRSTUVWXYZ",
  "abcdefghijkmnopqrstuvwxyz",
  "23456789",
] as const;

function randomChar(pool: string): string {
  return pool.charAt(randomInt(pool.length));
}

/**
 * 12 字元臨時密碼：保證至少一個大寫、一個小寫、一個數字。
 * 一律使用 crypto.randomInt（不可用 Math.random），最後以 Fisher–Yates 洗牌，
 * 避免前三碼固定是「大寫、小寫、數字」。
 */
function generateTempPassword(length = 12): string {
  const all = PASSWORD_POOLS.join("");
  const chars: string[] = PASSWORD_POOLS.map(randomChar);
  while (chars.length < length) chars.push(randomChar(all));

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }

  return chars.join("");
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

/** auth.users 查無此使用者（profile 是孤兒列）的錯誤判斷 */
function isAuthUserMissing(message: string | undefined): boolean {
  return /not\s*found|does not exist|no user/i.test(message ?? "");
}

export async function POST(
  request: Request,
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

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const mode =
      typeof body.mode === "string" ? body.mode.trim().toLowerCase() : "";
    if (mode !== "temp" && mode !== "link") {
      return jsonValidation({ mode: "模式只能是 temp 或 link。" });
    }

    /* ---------- 先確認會員存在並取得 email（profiles 沒有 email 欄） ---------- */
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
        "POST /api/admin/members/[id]/reset-password rpc",
        detailError
      );
    }

    const member = (detail ?? null) as MemberDetail | null;
    if (!member) return jsonNotFound("找不到這位會員。");

    const email = (member.email ?? "").trim();
    if (!email) {
      return jsonValidation({}, "此會員沒有電郵地址，無法重設密碼。");
    }
    const memberName = member.display_name || email;

    /* ---------- 兩種模式都需要 service_role（anon key 動不了 auth.users） ---------- */
    if (!isServiceRoleConfigured) {
      return NextResponse.json(
        {
          ok: false,
          code: "SERVICE_ROLE_REQUIRED",
          error: "未設定 SUPABASE_SERVICE_ROLE_KEY，無法重設密碼。",
        },
        { status: 501 }
      );
    }

    const adminClient = createAdminClient();

    /* ---------- mode = temp：產生臨時密碼，立即生效 ---------- */
    if (mode === "temp") {
      const password = generateTempPassword();

      const { error } = await adminClient.auth.admin.updateUserById(memberId, {
        password,
      });

      if (error) {
        if (isAuthUserMissing(error.message)) {
          return jsonValidation(
            {},
            "此會員在驗證系統（auth.users）中已不存在，可能只剩下個人資料，請先刪除後重建帳號。"
          );
        }
        return jsonInternal(
          "POST /api/admin/members/[id]/reset-password updateUserById",
          error
        );
      }

      // 摘要只寫「做了什麼」，絕不寫密碼
      await writeAuditLog(
        supabase,
        actorId,
        "members",
        "reset_password_temp",
        `為 ${memberName} 設定臨時密碼。`
      );

      return jsonOk({
        data: { mode: "temp", email, password },
        message: "已設定臨時密碼，請轉交會員並提醒登入後盡快更改。",
      });
    }

    /* ---------- mode = link：一次性重設連結 ---------- */
    const { data: linkData, error: linkError } =
      await adminClient.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${SITE_URL}/auth/reset` },
      });

    if (linkError) {
      if (isAuthUserMissing(linkError.message)) {
        return jsonValidation(
          {},
          "此會員在驗證系統（auth.users）中已不存在，可能只剩下個人資料，請先刪除後重建帳號。"
        );
      }
      return jsonValidation(
        {},
        `無法產生重設連結：${linkError.message ?? "未知錯誤"}`
      );
    }

    const actionLink = linkData?.properties?.action_link ?? "";
    if (!actionLink) {
      return jsonInternal(
        "POST /api/admin/members/[id]/reset-password generateLink",
        { message: "generateLink 沒有回傳 action_link" }
      );
    }

    await writeAuditLog(
      supabase,
      actorId,
      "members",
      "reset_password_link",
      `為 ${memberName} 產生密碼重設連結。`
    );

    return jsonOk({
      data: { mode: "link", email, action_link: actionLink },
      message: "已產生一次性重設連結，請轉交會員（連結有有效期）。",
    });
  } catch (err) {
    return jsonInternal("POST /api/admin/members/[id]/reset-password", err);
  }
}
