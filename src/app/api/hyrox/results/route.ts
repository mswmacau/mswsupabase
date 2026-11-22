/**
 * /api/hyrox/results — 會員端完賽成績提交（POST）與刪除待審提交（DELETE）
 *
 * 契約：docs/HYROX完賽排行榜與數據整合-方案-20261122.md §1.5-①②（定稿）
 * 骨架：逐段複製 src/app/api/runs/route.ts（JSON only／uid 前綴／
 *       screenshotExists／unique 409／storage 清理順序）。
 *
 * 錯誤訊息：全部使用方案 §5 第 6 條的凍結文案，逐字不改。
 *
 * 降級（§1.5-⑥）：migration 未跑時（hyrox_divisions / hyrox_results 不存在，
 * PostgREST 回 42P01 / PGRST205）→ 400 SCHEMA_OUTDATED（可讀訊息、不洩內部、
 * 零 console 輸出——「表還沒建」是預期狀態不是 bug，印出來只是噪音）。
 *
 * 安全要點：
 *   · user_id 一律取自 session，body 內的 user_id 一律忽略
 *   · image_path 必須落在 `${user.id}/` 之下（不能指到別人的截圖目錄）
 *   · 隊伍欄位與類別的一致性（單人不得填隊伍／隊伍類別必填）在 API 驗一次，
 *     DB 另有 hyrox_results_guard 觸發器當最後一道防線（繞過 API 直接打
 *     PostgREST 也擋得住）
 *
 * H6：全支包 try/catch，任何情況都回 JSON。
 * Owner：白客（backend-engineer）
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { todayISO } from "@/lib/utils";
import {
  jsonBadJson,
  jsonConflict,
  jsonErr,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonNotConfigured,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";

const IMAGE_PATH_RE = /^[\w./-]+\.(jpg|jpeg|png|webp|heic)$/i;
const BUCKET = "run-screenshots";

/** 嚴格 HH:MM:SS（各段補零；24:00:00 以上不收） */
const FINISH_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 隊友姓名上限（與 DB 觸發器 hyrox_results_guard 同口徑） */
const TEAMMATE_MAX = 40;

type Supabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;

/** 單一隊友姓名的合法形狀（非空、≤40 字） */
function validTeammate(v: unknown): v is string {
  return typeof v === "string" && v.trim().length >= 1 && v.trim().length <= TEAMMATE_MAX;
}

/**
 * 截圖物件是否真的存在（直傳後、寫 DB 前的存在性檢查；同 /api/runs）。
 * 查詢本身失敗時放行（不因為 Storage 抖一下就讓會員無法提交），
 * 管理員核可時仍會肉眼看到截圖。
 */
async function screenshotExists(supabase: Supabase, path: string): Promise<boolean | "unknown"> {
  const idx = path.indexOf("/");
  const dir = idx === -1 ? "" : path.slice(0, idx);
  const base = path.slice(idx + 1);

  try {
    const { data, error } = await supabase.storage.from(BUCKET).list(dir, {
      search: base,
      limit: 20,
    });
    if (error) return "unknown";
    return (data ?? []).some((o) => o.name === base);
  } catch {
    return "unknown";
  }
}

/**
 * 資料表還沒建（migration 未執行）的錯誤。
 * 42P01 = undefined_table；PGRST205 = PostgREST 在 schema cache 找不到該表。
 * （同 src/app/api/admin/hyrox/photos/route.ts:106-113 的判法）
 */
function isSchemaMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  if (code === "42P01" || code === "PGRST205") return true;
  return /does not exist|schema cache/i.test(message) && /hyrox_(results|divisions)/i.test(message);
}

/** 400 SCHEMA_OUTDATED（§1.5-⑥ 降級：可讀、不洩內部、零 console） */
function schemaOutdated() {
  return jsonErr("完賽排行榜尚未開放，請稍後再試。", "SCHEMA_OUTDATED", 400);
}

/** DB 讀寫失敗的統一出口：表未建 → 400；其餘交給 api.ts 的對映 */
function dbFail(where: string, error: unknown) {
  if (isSchemaMissing(error)) return schemaOutdated();
  return jsonInternal(where, error);
}

/** 只接受 POST／DELETE（H6：其他方法也要回 JSON，不回 Next 預設的 405 空 body） */
export async function GET() {
  return jsonMethodNotAllowed();
}
export const PUT = GET;
export const PATCH = GET;

/* =============================================================
 * POST — 提交完賽成績（§1.5-①）
 * ============================================================= */

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured) return jsonNotConfigured();

    const supabase = await createClient();
    if (!supabase) return jsonNotConfigured();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonUnauthenticated();

    // JSON only：圖片已在瀏覽器直傳 Storage，這裡只收路徑（同 /api/runs）
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonBadJson();
    }

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    /* --- 本地形狀狀驗證（欄位級錯誤一次收集，表單一次過顯示、滾到第一個錯）--- */
    const fields: Record<string, string> = {};

    // division_code
    const divisionCode =
      typeof body.division_code === "string" ? body.division_code.trim() : "";
    if (!divisionCode) fields.division_code = "請選擇比賽類別。";

    // finish_time → finish_seconds
    const finishRaw = typeof body.finish_time === "string" ? body.finish_time.trim() : "";
    let finishSeconds = 0;
    if (!FINISH_TIME_RE.test(finishRaw)) {
      fields.finish_time = "請填寫有效的完賽時間。";
    } else {
      const [h, m, s] = finishRaw.split(":").map(Number);
      finishSeconds = h * 3600 + m * 60 + s;
      // 60–86399：DB check 的同口徑（1 分鐘～23:59:59）
      if (finishSeconds < 60 || finishSeconds > 86399) {
        fields.finish_time = "請填寫有效的完賽時間。";
      }
    }

    // race_name
    const raceName = typeof body.race_name === "string" ? body.race_name.trim() : "";
    if (raceName.length < 1 || raceName.length > 80) {
      fields.race_name = "請填寫賽事名稱。";
    }

    // race_date：真實存在的日期，且不可晚於今天（澳門時區）
    const raceDate = typeof body.race_date === "string" ? body.race_date.trim() : "";
    if (!DATE_RE.test(raceDate) || !isRealDate(raceDate) || raceDate > todayISO()) {
      fields.race_date = "請填寫有效的比賽日期。";
    }

    // image_path：必須在呼叫者自己的目錄下（同 /api/runs 的判法）
    const rawPath = body.image_path;
    let imagePath = typeof rawPath === "string" ? rawPath.trim() : "";
    if (imagePath.startsWith("/")) imagePath = imagePath.slice(1);
    if (
      !imagePath ||
      imagePath.includes("..") ||
      !imagePath.startsWith(`${user.id}/`) ||
      !IMAGE_PATH_RE.test(imagePath)
    ) {
      fields.image_path = "請重新上傳完賽證明截圖。";
    }

    // note：選填，≤200 字（超長截斷而不是拒絕——備註不是關鍵欄位）
    let note: string | null = null;
    if (typeof body.note === "string" && body.note.trim() !== "") {
      note = body.note.trim().slice(0, 200);
    }

    // teammates：先驗形狀（陣列、每項都是 1–40 字的字串）；
    // 人數是否＝team_size−1 要等查到類別才能對
    let teammates: string[] = [];
    if (body.teammates !== undefined && body.teammates !== null) {
      if (!Array.isArray(body.teammates) || !body.teammates.every(validTeammate)) {
        fields.teammates = "隊友人數與所選類別不符，請檢查。";
      } else {
        teammates = (body.teammates as string[]).map((t) => t.trim());
      }
    }

    // team_name：形狀先放行（是否必填取決於類別），統一 trim
    let teamName: string | null = null;
    if (typeof body.team_name === "string" && body.team_name.trim() !== "") {
      const t = body.team_name.trim();
      if (t.length > 60) {
        fields.team_name = "這個類別需要填寫隊伍名稱。";
      } else {
        teamName = t;
      }
    }

    if (Object.keys(fields).length > 0) return jsonValidation(fields);

    /* --- 類別存在且啟用（DB 層驗證；順便帶 team_size 回來對隊伍欄位）--- */
    const { data: division, error: divisionErr } = await supabase
      .from("hyrox_divisions")
      .select("code, team_size, is_active")
      .eq("code", divisionCode)
      .maybeSingle();

    if (divisionErr) return dbFail("POST /api/hyrox/results read division", divisionErr);
    if (!division || division.is_active === false) {
      return jsonValidation({ division_code: "請選擇比賽類別。" });
    }

    const teamSize = Number(division.team_size ?? 1);

    /* --- 隊伍欄位與類別的一致性（與 DB 觸發器同口徑，錯誤用凍結文案）--- */
    if (teamSize === 1) {
      // 單人類別：表單根本不會送這兩個欄位；萬一送了就當沒看見（正規化），
      // 不用「單人不可填隊伍」這種沒進凍結清單的訊息嚇會員。
      teamName = null;
      teammates = [];
    } else {
      if (!teamName) {
        return jsonValidation({ team_name: "這個類別需要填寫隊伍名稱。" });
      }
      if (teammates.length !== teamSize - 1) {
        return jsonValidation({ teammates: "隊友人數與所選類別不符，請檢查。" });
      }
    }

    /* --- 截圖存在性（Storage 查不到「確定不存在」才擋；查詢失敗放行）--- */
    const exists = await screenshotExists(supabase, imagePath);
    if (exists === false) {
      return jsonValidation({ image_path: "請重新上傳完賽證明截圖。" });
    }

    /* --- 重複提交先查（給友好訊息）；unique 23505 是最終防線（並發雙擊）--- */
    const { data: existing, error: existingErr } = await supabase
      .from("hyrox_results")
      .select("id")
      .eq("user_id", user.id)
      .eq("division_code", divisionCode)
      .eq("race_date", raceDate)
      .maybeSingle();

    if (existingErr) return dbFail("POST /api/hyrox/results read existing", existingErr);
    if (existing) return jsonConflict("你已在這個類別提交過這一天的成績。");

    /* --- 寫入（status 明確送 'pending'，與 RLS with check 同值）--- */
    const { error: insertError } = await supabase.from("hyrox_results").insert({
      user_id: user.id,
      division_code: divisionCode,
      race_name: raceName,
      race_date: raceDate,
      finish_seconds: finishSeconds,
      team_name: teamName,
      teammates,
      image_path: imagePath,
      note,
      status: "pending",
    });

    if (insertError) {
      if (insertError.code === "23505") {
        return jsonConflict("你已在這個類別提交過這一天的成績。");
      }
      // 23503 = FK（division_code 不存在）：理論上前面已擋，這裡是第二道防線
      if (insertError.code === "23503") {
        return jsonValidation({ division_code: "請選擇比賽類別。" });
      }
      return dbFail("POST /api/hyrox/results insert", insertError);
    }

    revalidatePath("/hyrox/results");
    revalidatePath("/hyrox");

    return jsonOk({ message: "已提交，等待後台確認。" });
  } catch (err) {
    return jsonInternal("POST /api/hyrox/results", err);
  }
}

/* =============================================================
 * DELETE — 刪除自己的待審提交（§1.5-②）
 * ============================================================= */

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

    // 先確認這筆提交存在、屬於本人，且仍處於待審核狀態（同 /api/runs DELETE）
    const { data: row, error: readErr } = await supabase
      .from("hyrox_results")
      .select("id, image_path, status")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (readErr) return dbFail("DELETE /api/hyrox/results read", readErr);
    if (!row) return jsonNotFound("找不到這筆提交，或它不屬於你。");

    if (row.status !== "pending") {
      return jsonConflict("已審核的提交無法刪除。");
    }

    const { error: deleteErr } = await supabase
      .from("hyrox_results")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("status", "pending");

    if (deleteErr) return dbFail("DELETE /api/hyrox/results delete", deleteErr);

    // DB 刪成功才清 Storage（順序同 /api/runs：先刪列、再刪物件，
    // 反過來會出現「物件刪了、列還在」的懸空路徑）
    if (row.image_path) {
      await supabase.storage.from(BUCKET).remove([row.image_path]);
    }

    revalidatePath("/hyrox/results");

    return jsonOk({ message: "已刪除該筆提交。" });
  } catch (err) {
    return jsonInternal("DELETE /api/hyrox/results", err);
  }
}

/* =============================================================
 * 內部工具
 * ============================================================= */

/** YYYY-MM-DD 是否為真實存在的日期（擋 2026-02-30；不靠 Date 自動進位） */
function isRealDate(s: string): boolean {
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(5, 7));
  const day = Number(s.slice(8, 10));
  if (year < 2020 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= lastDay;
}
