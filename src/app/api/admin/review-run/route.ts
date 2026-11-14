import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { writeAuditLog } from "@/lib/audit";
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

/** 審核前的提交狀態（只為稽核摘要的 before→after） */
type SubmissionBefore = { memberName: string; kmText: string; status: string };

/**
 * 讀出「審核前」的提交狀態，給 admin_audit_log 的摘要用。
 *
 * best-effort：任何失敗都回傳「未取得」佔位值，永不拋出。
 * 理由與 writeAuditLog 一致 —— 稽核是事後屬性，
 * 不可以因為「摘要想寫得漂亮」而讓管理員審核不了。
 */
async function readSubmissionBefore(
  supabase: SupabaseClient,
  submissionId: string
): Promise<SubmissionBefore> {
  try {
    const { data: sub } = await supabase
      .from("run_submissions")
      .select("user_id, km, status")
      .eq("id", submissionId)
      .maybeSingle();
    if (!sub) {
      return { memberName: "未取得", kmText: "里程未取得", status: "未取得" };
    }

    const { data: member } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", sub.user_id)
      .maybeSingle();

    return {
      memberName: (member?.display_name as string | null) ?? "未取得",
      kmText:
        sub.km === null || sub.km === undefined
          ? "里程未取得"
          : `${Number(sub.km)} km`,
      status: typeof sub.status === "string" ? sub.status : "未取得",
    };
  } catch {
    return { memberName: "未取得", kmText: "里程未取得", status: "未取得" };
  }
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

    const approve = body.approve === true || body.approve === "true";
    const adminNote = text(body.admin_note);

    // P1-C：先讀出審核前的狀態，稽核摘要才能寫 before→after（讀不到就退化，不擋流程）
    const beforeSummary = await readSubmissionBefore(supabase, submissionId);

    const { data, error } = await supabase.rpc("review_run_submission", {
      p_submission_id: submissionId,
      p_approve: approve,
      p_admin_note: text(body.admin_note) || null,
    });

    // NEW-P2-2：RPC 以 P0001 raise「找不到該提交」→ 404，其餘才是 500
    if (error) return jsonDbError("POST /api/admin/review-run rpc", error);

    const row = (Array.isArray(data) ? data[0] : data) as { monthly_awarded?: boolean } | null;

    // P1-C：審核會直接加里程與積分（並可能觸發月度自動發券），屬於危險操作。
    // 成功後寫一筆稽核，含 before→after。
    // beforeSummary 是 best-effort：讀不到時摘要退化為「狀態未取得」，不影響審核。
    await writeAuditLog(
      supabase,
      user.id,
      "review-run",
      approve ? "approve" : "reject",
      `跑步提交審核${approve ? "通過" : "駁回"}：會員 ${beforeSummary.memberName}，${
        beforeSummary.kmText
      }，狀態 ${beforeSummary.status}→${approve ? "approved" : "rejected"}${
        adminNote ? `，備註「${adminNote.slice(0, 60)}」` : ""
      }${row?.monthly_awarded ? "，已觸發月度達標獎勵" : ""}`
    );

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
