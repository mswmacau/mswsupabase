import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isUuid,
  jsonBadJson,
  jsonDbError,
  jsonErr,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonNotConfigured,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";

/**
 * 報名／取消報名某一場訓練
 *
 * 【R6 驗收 P1-2 修正】原本 `await request.json()` 沒有保護，
 * 畸形 body 讓會員端報名 API 回 HTTP 500 + 空 body（違反 SPEC H6）。
 * 現在改用 readJson() + jsonBadJson()，並全支包 try/catch。
 */

/** 報名／簽到某一場訓練 */
export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured) return jsonNotConfigured();

    const supabase = await createClient();
    if (!supabase) return jsonErr("客戶端初始化失敗。", "INTERNAL", 500);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonUnauthenticated();

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    if (!sessionId) return jsonValidation({}, "缺少場次。");
    // NEW-P2-1：UUID 格式先驗，不讓 Postgres 22P02 變成 500
    if (!isUuid(sessionId)) return jsonValidation({ session_id: "編號格式錯誤。" });

    // NEW-P2-2：先查後寫，場次不存在 → 404（而不是讓 FK 錯誤變成 500）
    const { data: session } = await supabase
      .from("training_sessions")
      .select("id")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session) return jsonNotFound("找不到這個訓練場次。");

    const { error } = await supabase.from("training_checkins").upsert(
      { session_id: sessionId, user_id: user.id, status: "pending" },
      { onConflict: "session_id,user_id", ignoreDuplicates: true }
    );

    if (error) return jsonDbError("POST /api/training/checkins upsert", error);

    revalidatePath("/training");
    revalidatePath("/dashboard");

    return jsonOk();
  } catch (err) {
    return jsonDbError("POST /api/training/checkins", err);
  }
}

/** 取消報名（僅限尚未確認） */
export async function DELETE(request: Request) {
  try {
    if (!isSupabaseConfigured) return jsonNotConfigured();

    const supabase = await createClient();
    if (!supabase) return jsonErr("客戶端初始化失敗。", "INTERNAL", 500);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonUnauthenticated();

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    if (!sessionId) return jsonValidation({}, "缺少場次。");
    // NEW-P2-1：UUID 格式先驗，不讓 Postgres 22P02 變成 500
    if (!isUuid(sessionId)) return jsonValidation({ session_id: "編號格式錯誤。" });

    const { error } = await supabase
      .from("training_checkins")
      .delete()
      .eq("session_id", sessionId)
      .eq("user_id", user.id)
      .eq("status", "pending");

    if (error) return jsonDbError("DELETE /api/training/checkins delete", error);

    revalidatePath("/training");
    revalidatePath("/dashboard");

    return jsonOk();
  } catch (err) {
    return jsonDbError("DELETE /api/training/checkins", err);
  }
}

/**
 * 讀取「我在這幾場的報名狀態」（日期頁 `/training/[date]` 用）。
 *
 * 為什麼要另外開一個 GET：日期頁是 ISR（`revalidate = 60`），
 * 一旦在 Server Component 讀 cookie／profile，整頁就會被迫轉成動態渲染，
 * 快取直接失效。所以把那一段「只有本人看得到」的狀態留給 client 元件在
 * mount 後自己問，頁面本體維持可快取。
 *
 * 契約：
 *   GET /api/training/checkins?ids=<uuid>,<uuid>  （最多 20 個）
 *   200 { ok: true, authenticated: boolean, checkins: { [session_id]: status } }
 *   - 未登入不是錯誤：回 authenticated:false + 空物件，前台據此顯示「登入後報名」
 *   - ids 缺漏／格式錯誤 → 400 VALIDATION
 *
 * 只回自己的資料：RLS 的 `checkins_select` 是 `auth.uid() = user_id or is_admin()`，
 * 這裡再顯式加 `.eq("user_id", user.id)` 當第二道保險。
 */
export async function GET(request: Request) {
  try {
    if (!isSupabaseConfigured) return jsonNotConfigured();

    const supabase = await createClient();
    if (!supabase) return jsonErr("客戶端初始化失敗。", "INTERNAL", 500);

    const url = new URL(request.url);
    const raw = url.searchParams.get("ids") ?? "";
    const ids = raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (ids.length === 0) return jsonValidation({ ids: "缺少場次。" });
    if (ids.length > 20) return jsonValidation({ ids: "一次最多查 20 場。" });
    if (ids.some((id) => !isUuid(id))) {
      return jsonValidation({ ids: "編號格式錯誤。" });
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonOk({ authenticated: false, checkins: {} });

    const { data, error } = await supabase
      .from("training_checkins")
      .select("session_id, status")
      .eq("user_id", user.id)
      .in("session_id", ids);

    if (error) return jsonDbError("GET /api/training/checkins", error);

    const checkins: Record<string, string> = {};
    for (const row of (data ?? []) as { session_id: string; status: string }[]) {
      checkins[row.session_id] = row.status;
    }

    return jsonOk({ authenticated: true, checkins });
  } catch (err) {
    return jsonDbError("GET /api/training/checkins", err);
  }
}

/** NEW-P3：未實作的方法也要回 JSON（H6），不要讓框架回 405 空 body */
export async function PUT() {
  return jsonMethodNotAllowed();
}
