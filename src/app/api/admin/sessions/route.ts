import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  jsonBadJson,
  jsonErr,
  jsonForbidden,
  jsonDbError,
  jsonMethodNotAllowed,
  jsonNotConfigured,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";

/**
 * 建立／更新訓練場次（以日期為唯一鍵）
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

    const sessionDate = text(body.session_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate))
      return jsonValidation({}, "請選擇正確的日期。");

    const start = text(body.start_time) || "20:00";
    const end = text(body.end_time) || "21:00";

    const capacityRaw = Number(body.capacity ?? 30);
    const capacity = Number.isFinite(capacityRaw)
      ? Math.min(99999, Math.max(1, Math.trunc(capacityRaw)))
      : 30;

    const { error } = await supabase.from("training_sessions").upsert(
      {
        session_date: sessionDate,
        title: text(body.title) || "MSW 定期訓練",
        location: text(body.location) || "澳門街健館",
        starts_at: `${sessionDate}T${start}:00`,
        ends_at: `${sessionDate}T${end}:00`,
        capacity,
        note: text(body.note) || null,
        status: "open",
      },
      { onConflict: "session_date" }
    );

    if (error) return jsonDbError("POST /api/admin/sessions upsert", error);

    revalidatePath("/admin/sessions");
    revalidatePath("/training");

    return jsonOk({ message: `已建立 ${sessionDate} 的訓練場次。` });
  } catch (err) {
    return jsonDbError("POST /api/admin/sessions", err);
  }
}

/** NEW-P3：未實作的方法也要回 JSON（H6），不要讓框架回 405 空 body */
export async function GET() {
  return jsonMethodNotAllowed();
}
