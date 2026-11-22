/**
 * GET /api/admin/hyrox/registrations/export — HYROX 報名名單 CSV 匯出（管理員限定）
 *
 * 契約：docs/HYROX完賽排行榜與數據整合-方案-20261122.md §2.3 G-1（定稿）
 *       GET ?event_id=<uuid>&type=roster
 *   → 200 text/csv; charset=utf-8（UTF-8 BOM；RFC5987 雙檔名；no-store）
 *
 * 欄位（G-1 定稿，逐字）：
 *   display_name, full_name, gender, phone, id_last4, group_pref, weekly_freq,
 *   longest_run, payment_status, disclaimer_accepted_at, created_at
 *
 * 【四個必查安全項】
 *   · 越權：authorizeAdmin()（匯出檔含姓名與電話，權限一定在第一行擋）
 *   · IDOR：event_id 先 isUuid，再確認 series='hyrox'（同 registrations
 *           端點的把關；一般活動的 id 一律 404，不揭露）
 *   · 參數：type 只接受 roster（預設 roster），其餘 400 且有可讀訊息
 *   · 分頁：匯出自己翻頁（fetchAllPages：500／批，取到拿不滿一批為止，
 *           MAX_ROWS 硬上限），不依賴列表端點的單頁上限
 *
 * 【絕對不輸出的欄位】
 *   user_id、payment_proof_path（私有桶物件路徑外流沒有意義也不該發生）。
 *
 * 問卷答案（group_pref／weekly_freq／longest_run）依 Q-5 拍板只在 CSV，
 * 不上分析頁。
 *
 * Owner：白客（backend-engineer）
 */

import { authorizeAdmin } from "@/lib/admin-guard";
import {
  isUuid,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonValidation,
} from "@/lib/api";
import {
  csvCell,
  csvResponse,
  fetchAllPages,
  macauDateTime,
  macauStamp,
  phoneCell,
  sanitizeFilePart,
  textCell,
  toCsv,
} from "@/lib/csv-export";
import { HYROX_SERIES } from "@/app/api/hyrox/_shared/contract";

/** 目前只有一種檔；type 參數照 G-3 慣例保留，之後加明細／彙總時不用改 URL */
const EXPORT_TYPES = ["roster"] as const;
type ExportType = (typeof EXPORT_TYPES)[number];

const TYPE_LABEL: Record<ExportType, string> = { roster: "報名名單" };

/** 單次匯出的列數上限（超過就截斷並在 server log 留痕） */
const MAX_ROWS = 20000;

const NOT_FOUND_MSG = "找不到這筆 HYROX 場次。";

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  not_required: "免付款",
  pending_review: "待確認付款",
  confirmed: "已確認",
  rejected: "已退回",
};

const GENDER_LABEL: Record<string, string> = {
  male: "男",
  female: "女",
  undisclosed: "不透露",
};

/** PostgREST 回傳的原始列 */
type RawRow = {
  id: string;
  group_pref: string | null;
  weekly_freq: string | null;
  longest_run: string | null;
  payment_status: string;
  disclaimer_accepted_at: string | null;
  created_at: string;
  /** 出席點名（migration-event-attendance.sql）；未跑該 migration 時查不到此欄 */
  attended_at?: string | null;
  profile: {
    display_name: string | null;
    full_name: string | null;
    gender: string | null;
    phone: string | null;
    id_last4: string | null;
  } | null;
};

const COLUMNS =
  "id,group_pref,weekly_freq,longest_run,payment_status," +
  "disclaimer_accepted_at,created_at," +
  "profile:profiles!event_registrations_user_id_fkey(" +
  "display_name,full_name,gender,phone,id_last4)";

/** 出席點名欄位（migration-event-attendance.sql §1） */
const ATTENDANCE_COLUMN = "attended_at";
const COLUMNS_WITH_ATTENDANCE = `${COLUMNS},${ATTENDANCE_COLUMN}`;

/**
 * 欄位不存在（migration 未跑）：42703 / PGRST204。
 * 命中時本檔退回不含 attended_at 的查詢，CSV 的「出席」欄顯示「—」，
 * 而不是整份匯出失敗（降級硬要求）。
 */
function isMissingColumn(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "42703" || code === "PGRST204") return true;
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return /column .* does not exist|could not find the .*column/i.test(message);
}

export function POST() {
  return jsonMethodNotAllowed();
}
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;

export async function GET(request: Request) {
  try {
    /* ── 越權：第一行就擋 ─────────────────────────────────── */
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    /* ── IDOR 第一道：event_id 格式 ──────────────────────── */
    const params = new URL(request.url).searchParams;
    const eventId = (params.get("event_id") ?? "").trim();
    if (!eventId) return jsonValidation({ event_id: "缺少場次編號。" });
    if (!isUuid(eventId)) return jsonValidation({ event_id: "場次編號格式錯誤。" });

    /* ── 參數：type 只認列舉值（預設 roster）──────────────── */
    const rawType = (params.get("type") ?? "roster").trim();
    const type = (rawType === "" ? "roster" : rawType) as ExportType;
    if (!(EXPORT_TYPES as readonly string[]).includes(type)) {
      return jsonValidation({ type: `匯出類型只接受 ${EXPORT_TYPES.join("／")}。` });
    }

    /* ── IDOR 第二道：必須是 HYROX 場次（series='hyrox'）──── */
    const { data: event, error: eventErr } = await supabase
      .from("events")
      .select("id, title, series")
      .eq("id", eventId)
      .maybeSingle();

    if (eventErr) {
      return jsonInternal("GET /api/admin/hyrox/registrations/export read event", eventErr);
    }
    if (!event || (event as { series: string | null }).series !== HYROX_SERIES) {
      return jsonNotFound(NOT_FOUND_MSG);
    }

    /* ── 取數：自己翻頁（列表端點單頁 500 且 truncated 不自動續）──
     *
     * 出席欄（attended_at）是 migration-event-attendance.sql 才有的欄位。
     * 這裡先試「含出席欄」的查詢，若回 42703 / PGRST204（欄位不存在）
     * 就退回不含該欄的查詢，並把 attendanceAvailable 設為 false
     * → CSV 的「出席」欄顯示「—」，匯出本身照常成功（降級硬要求）。 */
    let attendanceAvailable = true;

    const queryPage = async (cols: string, from: number, to: number) => {
      const { data, error: pageErr } = await supabase
        .from("event_registrations")
        .select(cols)
        .eq("event_id", eventId)
        .eq("status", "registered")
        // created_at 可能同秒，補 id 排序才不會有列在分頁邊界被跳過／重複
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      return {
        rows: (data as unknown as RawRow[]) ?? [],
        error: pageErr,
      };
    };

    const { rows, error } = await fetchAllPages<RawRow>({
      label: "HYROX 報名名單匯出",
      maxRows: MAX_ROWS,
      fetchPage: async (from, to) => {
        if (!attendanceAvailable) return queryPage(COLUMNS, from, to);

        const withAttendance = await queryPage(COLUMNS_WITH_ATTENDANCE, from, to);
        if (withAttendance.error && isMissingColumn(withAttendance.error)) {
          attendanceAvailable = false;
          return queryPage(COLUMNS, from, to);
        }
        return withAttendance;
      },
    });

    if (error) {
      return jsonInternal("GET /api/admin/hyrox/registrations/export list", error);
    }

    /* ── 組 CSV（欄位順序＝G-1 定稿；出席欄由 migration-event-attendance.sql 追加）── */
    const header = [
      "會員名稱",
      "姓名",
      "性別",
      "電話",
      "證件後四碼",
      "組別偏好",
      "每週訓練頻率",
      "最長跑步距離",
      "付款狀態",
      "免責聲明同意時間",
      "報名時間",
      "出席",
    ];

    const body = rows.map((r) => [
      csvCell(r.profile?.display_name ?? ""),
      csvCell(r.profile?.full_name ?? ""),
      csvCell(r.profile?.gender ? (GENDER_LABEL[r.profile.gender] ?? r.profile.gender) : "未填"),
      phoneCell(r.profile?.phone),
      textCell(r.profile?.id_last4 ?? ""),
      csvCell(r.group_pref ?? ""),
      csvCell(r.weekly_freq ?? ""),
      csvCell(r.longest_run ?? ""),
      csvCell(PAYMENT_STATUS_LABEL[r.payment_status] ?? r.payment_status),
      textCell(r.disclaimer_accepted_at ? macauDateTime(r.disclaimer_accepted_at) : "未同意"),
      textCell(macauDateTime(r.created_at)),
      // 未跑 migration 時整欄顯示「—」（讀不到 ≠ 未出席，不可寫成「未出席」）
      csvCell(!attendanceAvailable ? "—" : r.attended_at ? "已出席" : "未出席"),
    ]);

    const csv = toCsv([header, ...body]);

    const stamp = macauStamp();
    const zhName = `${sanitizeFilePart(event.title, "HYROX")}-${TYPE_LABEL[type]}-${stamp}.csv`;
    const asciiName = `hyrox-registrations-${type}-${stamp}.csv`;

    return csvResponse({ csv, filenameZh: zhName, filenameAscii: asciiName });
  } catch (err) {
    return jsonInternal("GET /api/admin/hyrox/registrations/export", err);
  }
}
