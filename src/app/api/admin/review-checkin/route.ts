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
 * 審核訓練簽到（通過／駁回）
 *
 * 【R6 驗收 P1-2 修正】畸形 body 原本會裸奔成 500 空 body，
 * 改用 readJson() + jsonBadJson()，並全支包 try/catch。
 */

/** 安全取字串 */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 審核前的簽到狀態（只為稽核摘要的 before→after） */
type CheckinBefore = { memberName: string; sessionDate: string; status: string };

/**
 * 讀出「審核前」的簽到狀態，給 admin_audit_log 的摘要用。
 * best-effort：任何失敗都回傳「未取得」佔位值，永不拋出（理由同 writeAuditLog）。
 */
async function readCheckinBefore(
  supabase: SupabaseClient,
  checkinId: string
): Promise<CheckinBefore> {
  try {
    const { data: row } = await supabase
      .from("training_checkins")
      .select("user_id, session_id, status")
      .eq("id", checkinId)
      .maybeSingle();
    if (!row) {
      return { memberName: "未取得", sessionDate: "場次未取得", status: "未取得" };
    }

    const { data: member } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", row.user_id)
      .maybeSingle();

    let sessionDate = "場次未取得";
    if (row.session_id) {
      const { data: session } = await supabase
        .from("training_sessions")
        .select("session_date")
        .eq("id", row.session_id)
        .maybeSingle();
      if (typeof session?.session_date === "string") {
        sessionDate = session.session_date;
      }
    }

    return {
      memberName: (member?.display_name as string | null) ?? "未取得",
      sessionDate,
      status: typeof row.status === "string" ? row.status : "未取得",
    };
  } catch {
    return { memberName: "未取得", sessionDate: "場次未取得", status: "未取得" };
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

    const checkinId = text(body.checkin_id);
    if (!checkinId) return jsonValidation({}, "缺少簽到編號。");
    // NEW-P2-1：UUID 格式先驗，不讓 Postgres 22P02 變成 500
    if (!isUuid(checkinId)) return jsonValidation({ checkin_id: "編號格式錯誤。" });

    const approve = body.approve === true || body.approve === "true";
    const adminNote = text(body.admin_note);

    // P1-C：先讀出審核前的狀態，稽核摘要才能寫 before→after（讀不到就退化，不擋流程）
    const beforeSummary = await readCheckinBefore(supabase, checkinId);

    const { error } = await supabase.rpc("review_checkin", {
      p_checkin_id: checkinId,
      p_approve: approve,
      p_admin_note: adminNote || null,
    });

    // NEW-P2-2：RPC 以 P0001 raise「找不到該簽到紀錄」→ 404，其餘才是 500
    if (error) return jsonDbError("POST /api/admin/review-checkin rpc", error);

    // P1-C：簽到通過會直接加分，屬於危險操作 —— 成功後寫一筆稽核。
    await writeAuditLog(
      supabase,
      user.id,
      "review-checkin",
      approve ? "approve" : "reject",
      `簽到審核${approve ? "通過" : "駁回"}：會員 ${beforeSummary.memberName}，場次 ${
        beforeSummary.sessionDate
      }，狀態 ${beforeSummary.status}→${approve ? "approved" : "rejected"}${
        adminNote ? `，備註「${adminNote.slice(0, 60)}」` : ""
      }`
    );

    revalidatePath("/admin/checkins");
    revalidatePath("/admin");

    return jsonOk();
  } catch (err) {
    return jsonDbError("POST /api/admin/review-checkin", err);
  }
}

/** NEW-P3：未實作的方法也要回 JSON（H6），不要讓框架回 405 空 body */
export async function GET() {
  return jsonMethodNotAllowed();
}
