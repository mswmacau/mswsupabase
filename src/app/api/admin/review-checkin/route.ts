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
 * 審核訓練簽到（通過／駁回）
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

    const checkinId = text(body.checkin_id);
    if (!checkinId) return jsonValidation({}, "缺少簽到編號。");
    // NEW-P2-1：UUID 格式先驗，不讓 Postgres 22P02 變成 500
    if (!isUuid(checkinId)) return jsonValidation({ checkin_id: "編號格式錯誤。" });

    const { error } = await supabase.rpc("review_checkin", {
      p_checkin_id: checkinId,
      p_approve: body.approve === true || body.approve === "true",
      p_admin_note: text(body.admin_note) || null,
    });

    // NEW-P2-2：RPC 以 P0001 raise「找不到該簽到紀錄」→ 404，其餘才是 500
    if (error) return jsonDbError("POST /api/admin/review-checkin rpc", error);

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
