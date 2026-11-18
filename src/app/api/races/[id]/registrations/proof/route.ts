/**
 * POST /api/races/[id]/registrations/proof — 上載付款截圖（會員端）
 *
 * 契約：multipart/form-data，欄位名 file
 *   · 未登入 → 401；id 非 uuid → 400
 *   · 非 multipart → 400
 *   · 不是圖片（含 .exe 改副檔名）→ 400（看檔頭魔術數字，不看檔名）
 *   · 超過 5MB → 413
 *   · 賽事不存在／不是賽事 → 404；賽事已截止 → 409
 *   · 沒有報名 → 404；報名已取消 → 409
 *   · 成功 → 200 { ok:true, path, payment_status }
 *
 * 【為什麼回 path 不回 signed URL】
 * 前台只需要知道「已上載成功」，截圖要看由後台用 1 小時 signed URL 簽
 * （src/app/api/admin/races/[id]/registrations/route.ts）。私有桶的檔案不該
 * 在會員端被換成可分享的網址。
 *
 * 【路徑為什麼不是 races/{eventId}/{userId}/{ts}.{ext}】
 * run-screenshots 的 insert 政策 runshots_insert_own（supabase/schema.sql:866-872）
 * 是 (storage.foldername(name))[1] = auth.uid()::text —— 第一層資料夾必須是自己的
 * uid。原本設計的第一層是 races，會被 RLS 直接擋成 42501；本站沒有 service_role
 * key 可繞過，也不該為此另建 bucket。所以改成
 *     {userId}/races/{eventId}/{timestamp}.{ext}
 * 語意不變（本人／本場／不覆寫），而且 client 完全不能指定路徑。
 * 詳見 src/app/api/races/_shared.ts 的 buildProofPath()。
 *
 * 【payment_status 的真相】
 * race_registrations_guard 觸發器會把非管理員寫的 payment_status 還原成原值，
 * 所以「上載證明 → 變 pending」只有在原本就是 pending 時成立（付費賽事）。
 * 免費賽事（not_required）上載後仍是 not_required，本端點照實回傳資料庫的值，
 * 不假裝成功。
 *
 * 【安全】
 *   · 路徑由伺服器用 user.id 組，client 傳什麼路徑都不理。
 *   · 只更新自己的那一筆（event_id + user_id 雙條件）。
 *   · 錯誤訊息不含 bucket 名、物件路徑、Storage 原文。
 *
 * Owner：白客（backend-engineer）
 */

import {
  isUuid,
  jsonErr,
  jsonConflict,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
} from "@/lib/api";
import { dbFail } from "@/app/api/admin/races/_shared";
import {
  CANCELLED_EDIT_MSG,
  PROOF_BAD_TYPE_MSG,
  PROOF_BUCKET,
  PROOF_EXT,
  PROOF_MAX_BYTES,
  PROOF_MIME,
  PROOF_TOO_LARGE_MSG,
  RACE_NOT_FOUND_MSG,
  REGISTRATION_NOT_FOUND_MSG,
  acceptingError,
  buildProofPath,
  loadMemberRace,
  proofUploadFailed,
  requireMember,
  sniffImageMime,
} from "@/app/api/races/_shared";

type Ctx = { params: Promise<{ id: string }> };

/** 早退：請求本體超過這個量（含 multipart 邊界餘裕）就直接 413，不必先吃完 */
const EARLY_LIMIT_BYTES = PROOF_MAX_BYTES + 512 * 1024;

function pgCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

export function GET() {
  return jsonMethodNotAllowed();
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const auth = await requireMember();
    if (!auth.ok) return auth.res;
    const { supabase, user } = auth.ctx;

    const { id } = await ctx.params;
    const eventId = (id ?? "").trim();
    if (!isUuid(eventId)) return jsonValidation({ id: "賽事編號格式錯誤。" });

    /* --- Content-Type 必須是 multipart/form-data --- */
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return jsonValidation({}, "請以 multipart/form-data 上載圖片（欄位名稱 file）。");
    }

    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > EARLY_LIMIT_BYTES) {
      return jsonErr(PROOF_TOO_LARGE_MSG, "VALIDATION", 413);
    }

    /* --- 賽事守門 --- */
    const { row: race, error: raceErr } = await loadMemberRace(supabase, eventId);
    if (raceErr) return dbFail("POST /api/races/[id]/registrations/proof race", raceErr);
    if (!race) return jsonNotFound(RACE_NOT_FOUND_MSG);

    const blocked = acceptingError(race);
    if (blocked) {
      return jsonConflict(`報名已截止，無法上載付款證明（${blocked}）請聯絡教練。`);
    }

    /* --- 必須先有報名（且不是已取消） --- */
    const { data: currentRow, error: curErr } = await supabase
      .from("race_registrations")
      .select("id,status,payment_status")
      .eq("event_id", eventId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (curErr) return dbFail("POST /api/races/[id]/registrations/proof read", curErr);
    if (!currentRow) return jsonNotFound(REGISTRATION_NOT_FOUND_MSG);

    const current = currentRow as { id: string; status: string; payment_status: string };
    if (current.status === "cancelled") return jsonConflict(CANCELLED_EDIT_MSG);

    /* --- 取檔案 --- */
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonValidation({ file: "表單格式錯誤，請重新選擇檔案。" });
    }

    const file = form.get("file");
    if (
      typeof file !== "object" ||
      file === null ||
      typeof (file as Blob).arrayBuffer !== "function"
    ) {
      return jsonValidation({ file: "請選擇要上載的付款截圖。" });
    }
    const blob = file as File;

    if (blob.size <= 0) return jsonValidation({ file: "檔案是空的，請重新選擇。" });
    if (blob.size > PROOF_MAX_BYTES) {
      return jsonErr(PROOF_TOO_LARGE_MSG, "VALIDATION", 413);
    }

    const buffer = await blob.arrayBuffer();
    const sniffed = sniffImageMime(new Uint8Array(buffer.slice(0, 16)));
    if (!sniffed || !(PROOF_MIME as readonly string[]).includes(sniffed)) {
      return jsonValidation({ file: PROOF_BAD_TYPE_MSG });
    }

    const ext = PROOF_EXT[sniffed];
    const path = buildProofPath(user.id, eventId, ext);

    /* --- 上載到私有桶 --- */
    const { error: upErr } = await supabase.storage
      .from(PROOF_BUCKET)
      .upload(path, buffer, {
        upsert: false,
        cacheControl: "31536000",
        contentType: sniffed,
      });

    if (upErr) {
      const status = Number((upErr as { statusCode?: unknown }).statusCode ?? 0);
      const message = String((upErr as { message?: unknown }).message ?? "");
      console.error("[api] races proof upload failed:", status, message);
      if (status === 403 || /row-level security|permission/i.test(message)) {
        return jsonErr("沒有上載權限，請重新登入後再試。", "FORBIDDEN", 403);
      }
      return proofUploadFailed();
    }

    /* --- 寫回自己的 registration ---
     * status 一起送 'submitted'：RLS 的 with check 只允許 submitted／cancelled，
     * 已 confirmed 的列若只改截圖路徑會被政策擋掉（42501）。
     * payment_status 送 pending 是「意圖」，實際值以觸發器還原後的結果為準。 */
    const patch: Record<string, unknown> = {
      payment_proof_path: path,
      payment_status: "pending",
    };
    if (current.status !== "submitted") patch.status = "submitted";

    const { data: updated, error: updErr } = await supabase
      .from("race_registrations")
      .update(patch)
      .eq("id", current.id)
      .eq("user_id", user.id)
      .select("payment_status")
      .maybeSingle();

    if (updErr || !updated) {
      // 檔案已上載但 DB 沒記到：把檔案刪掉，不留下孤兒物件
      const { error: rmErr } = await supabase.storage.from(PROOF_BUCKET).remove([path]);
      if (rmErr) console.warn("[api] races proof rollback remove failed:", rmErr.message);

      if (pgCode(updErr) === "42501" || !updated) {
        return jsonConflict("報名狀態已變更，無法上載付款證明，請重新整理後再試。");
      }
      return dbFail("POST /api/races/[id]/registrations/proof update", updErr);
    }

    const paymentStatus = String(
      (updated as { payment_status?: string }).payment_status ?? current.payment_status
    );

    return jsonOk({ path, payment_status: paymentStatus });
  } catch (err) {
    return jsonInternal("POST /api/races/[id]/registrations/proof", err);
  }
}

export function PATCH() {
  return jsonMethodNotAllowed();
}

export function DELETE() {
  return jsonMethodNotAllowed();
}
