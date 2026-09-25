import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { RULES } from "@/lib/config";
import { currentMonth } from "@/lib/utils";
import {
  jsonBadJson,
  jsonConflict,
  jsonInternal,
  jsonNotFound,
  jsonNotConfigured,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";

const MONTH_RE = /^\d{4}-\d{2}$/;
const IMAGE_PATH_RE = /^[\w./-]+\.(jpg|jpeg|png|webp|heic)$/i;
const BUCKET = "run-screenshots";

type Supabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;

/** 截圖物件是否真的存在（直傳後、寫 DB 前的存在性檢查） */
async function screenshotExists(supabase: Supabase, path: string): Promise<boolean> {
  const idx = path.indexOf("/");
  const dir = idx === -1 ? "" : path.slice(0, idx);
  const base = path.slice(idx + 1);

  const { data, error } = await supabase.storage.from(BUCKET).list(dir, {
    search: base,
    limit: 20,
  });

  if (error || !data?.length) return false;
  return data.some((o) => o.name === base);
}

/**
 * 上傳跑步紀錄（JSON only）
 *
 * 改造原因（需求 D）：原本收 FormData，整張圖片會穿過 Vercel Function，
 * 超過 Hobby 方案 4.5MB 上限時平台直接回 HTML 413（handler 根本沒執行），
 * 前端 res.json() 解析 HTML 拋錯 → 顯示無法診斷的「網路錯誤」。
 * 現在改為：瀏覽器 canvas 壓縮 → 直傳 Supabase Storage → 只把 path 以 JSON 送來。
 *
 * 契約：SPEC-R6.md §2.8
 */
export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured) return jsonNotConfigured();

    const supabase = await createClient();
    if (!supabase) return jsonNotConfigured();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonUnauthenticated();

    // 明確拒絕 multipart/form-data：本 API 已改為 JSON only
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonBadJson();
    }

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    /* --- km --- */
    const kmRaw = body.km;
    const km = typeof kmRaw === "number" ? kmRaw : Number(String(kmRaw ?? "").trim());
    if (!Number.isFinite(km) || km <= 0 || km > RULES.MAX_KM_PER_SUBMISSION) {
      return jsonValidation({}, "請填寫有效的公里數（0.01–200）。");
    }

    /* --- period_month --- */
    const month = String(body.period_month ?? currentMonth()).trim();
    if (!MONTH_RE.test(month)) {
      return jsonValidation({}, "月份格式錯誤。");
    }

    /* --- image_path：必須在呼叫者自己的目錄下 --- */
    const rawPath = body.image_path;
    let imagePath = typeof rawPath === "string" ? rawPath.trim() : "";
    // 去掉可能的 "./" 或 "/uid/..." 前綴混淆，只接受嚴格的 uid/ 開頭
    if (imagePath.startsWith("/")) imagePath = imagePath.slice(1);
    if (
      !imagePath ||
      imagePath.includes("..") ||
      !imagePath.startsWith(`${user.id}/`) ||
      !IMAGE_PATH_RE.test(imagePath)
    ) {
      return jsonValidation({}, "請重新上傳跑步截圖。");
    }

    if (!(await screenshotExists(supabase, imagePath))) {
      return jsonValidation({}, "截圖上傳失敗，請重新上傳後再提交。");
    }

    /* --- note --- */
    const rawNote = body.note;
    let note: string | null = null;
    if (typeof rawNote === "string" && rawNote.trim() !== "") {
      note = rawNote.trim().slice(0, 200);
    }

    const { error: insertError } = await supabase.from("run_submissions").insert({
      user_id: user.id,
      km,
      period_month: month,
      image_path: imagePath,
      note,
      status: "pending",
    });

    if (insertError) return jsonInternal("POST /api/runs insert", insertError);

    revalidatePath("/run");
    revalidatePath("/dashboard");
    revalidatePath("/leaderboard");

    return jsonOk({ message: `已提交 ${km} 公里，等待後台確認。` });
  } catch (err) {
    return jsonInternal("POST /api/runs", err);
  }
}

/** 刪除自己尚未審核的提交（§2.0：維持原邏輯與原 HTTP status 不變） */
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    if (!supabase) return jsonNotConfigured();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonUnauthenticated();

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return jsonValidation({}, "缺少 id。");

    // 先確認這筆提交存在、屬於本人，且仍處於待審核狀態
    const { data: row } = await supabase
      .from("run_submissions")
      .select("id, image_path, status")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!row)
      return jsonNotFound("找不到這筆提交，或它不屬於你。");

    if (row.status !== "pending")
      return jsonConflict("已審核的提交無法刪除。");

    const { error } = await supabase
      .from("run_submissions")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("status", "pending");

    if (error) return jsonInternal("DELETE /api/runs delete", error);

    if (row.image_path)
      await supabase.storage.from(BUCKET).remove([row.image_path]);

    revalidatePath("/run");
    revalidatePath("/dashboard");

    return jsonOk({ message: "已刪除該筆提交。" });
  } catch (err) {
    return jsonInternal("DELETE /api/runs", err);
  }
}
