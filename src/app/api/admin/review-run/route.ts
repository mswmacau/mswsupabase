import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  jsonBadJson,
  jsonErr,
  jsonForbidden,
  isUuid,
  jsonDbError,
  jsonMethodNotAllowed,
  jsonNotConfigured,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";

/**
 * 審核跑步提交：通過 → 加分 + 累加里程 + 檢查月度達標自動發券
 *
 * 【R6 驗收 P1-2 修正】畸形 body 原本會裸奔成 500 空 body，
 * 改用 readJson() + jsonBadJson()，並全支包 try/catch。
 */

/** 安全取字串 */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

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

    const submissionId = text(body.submission_id);
    if (!submissionId) return jsonValidation({}, "缺少提交編號。");
    // NEW-P2-1：UUID 格式先驗，不讓 Postgres 22P02 變成 500
    if (!isUuid(submissionId))
      return jsonValidation({ submission_id: "編號格式錯誤。" });

    const { data, error } = await supabase.rpc("review_run_submission", {
      p_submission_id: submissionId,
      p_approve: body.approve === true || body.approve === "true",
      p_admin_note: text(body.admin_note) || null,
    });

    // NEW-P2-2：RPC 以 P0001 raise「找不到該提交」→ 404，其餘才是 500
    if (error) return jsonDbError("POST /api/admin/review-run rpc", error);

    const row = (Array.isArray(data) ? data[0] : data) as { monthly_awarded?: boolean } | null;

    revalidatePath("/admin/runs");
    revalidatePath("/admin");
    revalidatePath("/admin/monthly");
    revalidatePath("/leaderboard");

    return jsonOk({ monthly_awarded: Boolean(row?.monthly_awarded) });
  } catch (err) {
    return jsonDbError("POST /api/admin/review-run", err);
  }
}

/** NEW-P3：未實作的方法也要回 JSON（H6），不要讓框架回 405 空 body */
export async function GET() {
  return jsonMethodNotAllowed();
}
