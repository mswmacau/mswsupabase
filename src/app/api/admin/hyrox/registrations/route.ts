/**
 * GET /api/admin/hyrox/registrations?event_id=<uuid> — 某場 HYROX 的報名名單（管理員限定）
 *
 * 回傳：{ ok:true, event:{id,title}, registrations:[{
 *   registration_id, display_name, full_name, gender, phone, id_last4,
 *   group_pref, weekly_freq, longest_run, payment_status, admin_note,
 *   created_at, proof_url }] }
 *
 * 契約要點：
 *   · proof_url 用 signed URL（1 小時），因為付款截圖放在私有桶 run-screenshots。
 *   · 只列 status='registered' 的列（會員取消報名是 DELETE 該列，理論上不會有
 *     cancelled，但仍以 status 過濾，避免日後軟取消把名單弄亂）。
 *   · event_id 必須是 HYROX 場次；一般活動的報名名單請走別的端點。
 *
 * 安全：
 *   · 全部經 authorizeAdmin()：未設定 400 / 未登入 401 / 非管理員 403。
 *   · event_id 先驗 uuid，不讓 Postgres 22P02 變 500。
 *   · 個資（姓名／電話／證件後四位）只在這裡回給已授權管理員；server log 不印。
 *
 * Owner：白客（backend-engineer）
 */

import {
  isUuid,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
} from "@/lib/api";
import { authorizeAdmin } from "@/lib/admin-guard";
import {
  HYROX_SERIES,
  PROOF_BUCKET,
  PROOF_URL_TTL,
} from "@/app/api/hyrox/_shared/contract";
import type { HyroxAdminRegistrationRow, PaymentStatus } from "@/lib/types";

const NOT_FOUND_MSG = "找不到這筆 HYROX 場次。";

/** PostgREST 回傳的原始列（profile 是嵌入的關聯物件） */
type RawRow = {
  id: string;
  created_at: string;
  group_pref: string | null;
  weekly_freq: string | null;
  longest_run: string | null;
  payment_status: PaymentStatus;
  payment_amount_cents: number | null;
  payment_proof_path: string | null;
  admin_note: string | null;
  /** 出席點名（migration-event-attendance.sql）；未跑該 migration 時查不到此欄 */
  attended_at?: string | null;
  profile: {
    display_name: string | null;
    full_name: string | null;
    gender: HyroxAdminRegistrationRow["gender"];
    phone: string | null;
    id_last4: string | null;
  } | null;
};

/**
 * 回傳列的型別：既有的 HyroxAdminRegistrationRow 再補 attended_at。
 *
 * 為什麼不直接改 src/lib/types.ts 的介面：那支是共用檔（前端型別也在用），
 * 本輪只動本檔；這裡用交集型別達到同樣效果，回應多了 attended_at 但既有
 * 欄位一個都沒少，前端加欄位即可讀。
 */
type RegistrationWithAttendance = HyroxAdminRegistrationRow & {
  /** 已點名的時間（ISO）；null = 未點名。migration 未跑時一律 null */
  attended_at: string | null;
};

const BASE_COLUMNS =
  "id,created_at,group_pref,weekly_freq,longest_run,payment_status," +
  "payment_amount_cents,payment_proof_path,admin_note," +
  "profile:profiles!event_registrations_user_id_fkey(" +
  "display_name,full_name,gender,phone,id_last4)";

/** 出席點名欄位（migration-event-attendance.sql §1） */
const COLUMNS_WITH_ATTENDANCE = `${BASE_COLUMNS},attended_at`;

/**
 * 欄位不存在（migration 未跑）：42703 / PGRST204。
 * 命中時退回不含 attended_at 的查詢，attended_at 一律回 null，
 * **不是** 500（降級硬要求）。判斷與名單匯出端點同款。
 */
function isMissingColumn(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "42703" || code === "PGRST204") return true;
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return /column .* does not exist|could not find the .*column/i.test(message);
}

export async function GET(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    const eventId = (new URL(request.url).searchParams.get("event_id") ?? "").trim();
    if (!eventId) return jsonValidation({ event_id: "缺少場次編號。" });
    if (!isUuid(eventId)) return jsonValidation({ event_id: "編號格式錯誤。" });

    // 先確認場次存在且屬於 HYROX（避免用一般活動的 id 撈到別的模組的報名）
    const { data: event, error: eventErr } = await supabase
      .from("events")
      .select("id, title, series")
      .eq("id", eventId)
      .maybeSingle();

    if (eventErr) return jsonInternal("GET /api/admin/hyrox/registrations read event", eventErr);
    if (!event || (event as { series: string | null }).series !== HYROX_SERIES) {
      return jsonNotFound(NOT_FOUND_MSG);
    }

    /**
     * event_registrations 有兩條 FK 指向 profiles（user_id / reviewed_by），
     * 必須用 !外鍵約束名 指定，否則 PostgREST 會回 PGRST201 歧義錯誤。
     */
    // 一頁上限 500：契約沒有分頁參數，超量時明確告知（不靜默截斷，
    // 免得管理員以為名單只有 500 人）
    const PAGE_LIMIT = 500;

    const queryRows = (cols: string) =>
      supabase
        .from("event_registrations")
        .select(cols)
        .eq("event_id", eventId)
        .eq("status", "registered")
        .order("created_at", { ascending: true })
        .limit(PAGE_LIMIT);

    // 先試含出席欄的查詢；欄位不存在（migration 未跑）就退回不含該欄的版本。
    // 兩次查詢的條件完全相同，只是 select 清單不同。
    let result = await queryRows(COLUMNS_WITH_ATTENDANCE);
    if (result.error && isMissingColumn(result.error)) {
      result = await queryRows(BASE_COLUMNS);
    }

    const { data, error } = result;

    if (error) {
      return jsonInternal("GET /api/admin/hyrox/registrations read", error);
    }

    const rows = (data as unknown as RawRow[]) ?? [];

    // 付款截圖：私有桶 → 一次簽一批（1 小時），只簽有值的列
    const paths = rows
      .map((r) => r.payment_proof_path)
      .filter((p): p is string => typeof p === "string" && p.length > 0);

    const urlMap = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed, error: signErr } = await supabase.storage
        .from(PROOF_BUCKET)
        .createSignedUrls(paths, PROOF_URL_TTL);

      if (signErr) {
        // 簽名失敗不影響名單本身（proof_url 回 null），但要在 server log 留痕
        console.warn("[admin/hyrox] 付款截圖簽名失敗（proof_url 回 null）：", signErr.message);
      }
      for (const item of signed ?? []) {
        if (item.path && item.signedUrl) urlMap.set(item.path, item.signedUrl);
      }
    }

    const registrations: RegistrationWithAttendance[] = rows.map((r) => ({
      registration_id: r.id,
      display_name: r.profile?.display_name ?? null,
      full_name: r.profile?.full_name ?? null,
      gender: r.profile?.gender ?? null,
      phone: r.profile?.phone ?? null,
      id_last4: r.profile?.id_last4 ?? null,
      group_pref: r.group_pref,
      weekly_freq: r.weekly_freq,
      longest_run: r.longest_run,
      payment_status: r.payment_status,
      payment_amount_cents: r.payment_amount_cents,
      admin_note: r.admin_note,
      created_at: r.created_at,
      proof_url: r.payment_proof_path ? (urlMap.get(r.payment_proof_path) ?? null) : null,
      // 未跑 migration 時這個鍵不存在 → 一律回 null（不是 undefined、不是省略）
      attended_at: r.attended_at ?? null,
    }));

    return jsonOk({
      event: { id: (event as { id: string }).id, title: (event as { title: string }).title },
      registrations,
      /** true = 已達 500 筆上限，名單可能未列完（契約外加欄位） */
      truncated: rows.length >= PAGE_LIMIT,
    });
  } catch (err) {
    return jsonInternal("GET /api/admin/hyrox/registrations", err);
  }
}

/** H6：未實作的方法也要回 JSON */
export async function POST() {
  return jsonMethodNotAllowed();
}
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
