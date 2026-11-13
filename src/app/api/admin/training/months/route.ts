/**
 * GET  /api/admin/training/months — 月份列表（含發布狀態與場次數）
 * POST /api/admin/training/months — { action: 'publish' | 'unpublish' | 'update', year, month, publish_at?, note? }
 *
 * 契約：supabase/migration-training-months.sql（training_months 為唯一真相）
 *
 * 【語義】班表的發布單位是「月」。
 *   · publish   ：status='published'。publish_at 沒給就設為「該月 1 日 00:00 +08」，
 *                 也就是客戶說的「到 12 月 1 日自動上架」。
 *                 **允許未來月份預先發布** —— 狀態先標成 published，
 *                 時間沒到之前 anon 仍然看不到（可見性由 is_month_visible() 判定），
 *                 客戶可以提前把 12 月準備好，時間到自己上架。
 *   · unpublish ：status='draft'，publish_at 清空。前台立刻看不到該月。
 *   · update    ：只動 publish_at / note，不改 status（避免誤把草稿月份發布出去）。
 *
 * 權限：authorizeAdmin()（未設定 400 / 未登入 401 / 非管理員 403）
 * 註：RLS 是第二道防線，函式內另有 is_admin() / service_role 檢查。
 *
 * Owner：白客（backend-engineer）
 */

import { writeAuditLog } from "@/lib/audit";
import {
  jsonBadJson,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";
import {
  authorizeAdmin,
  currentMacauMonth,
  isIntInRange,
  isValidDate,
  jsonTrainingDbError,
  monthStartISO,
  revalidateTrainingSchedule,
  text,
} from "../_shared";

const MIGRATION = "supabase/migration-training-months.sql";
/** 月份列表一次最多回幾筆（24 個月視窗 + 視窗外的已發布月份，60 筆足夠） */
const LIMIT = 60;
const NOTE_MAX = 500;

const MONTH_SELECT = "year, month, status, publish_at, note";

type MonthRow = {
  year: number;
  month: number;
  status: "draft" | "published";
  publish_at: string | null;
  note: string | null;
};

/** 年月的線性索引，方便做「近 N 個月」視窗與排序（月份 1-based） */
function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function fromMonthIndex(index: number): { year: number; month: number } {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** 該月第一天與最後一天（YYYY-MM-DD） */
function monthBounds(year: number, month: number): { from: string; to: string } {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 有日期與時間但沒有時區偏移（例如 2026-12-01T00:00）—— 視為澳門時間 */
const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/**
 * 解析 publish_at。回傳 `{ ok:false }` 表示格式不合法（呼叫端回 400）。
 *
 * 接受的寫法：
 *   · undefined / null / ""        → null（語義：該月 1 日 00:00 +08）
 *   · 'YYYY-MM-DD'                → 補 T00:00:00+08:00
 *   · 'YYYY-MM-DDTHH:MM[:SS]'     → 補 +08:00（客戶在後台填的是澳門牆上時間）
 *   · 已帶 Z 或 ±HH:MM 的 ISO     → 原樣解析
 *
 * 一律以 `toISOString()` 落地（同一個瞬間的不同表示），DB 是 timestamptz，不受影響。
 */
function parsePublishAt(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };

  const raw = text(value);
  if (raw === "") return { ok: true, value: null };

  let candidate = raw;
  if (DATE_ONLY_RE.test(raw)) candidate = `${raw}T00:00:00+08:00`;
  else if (LOCAL_DATETIME_RE.test(raw)) candidate = `${raw}+08:00`;

  // 先驗證日期本身真實存在（擋 2026-02-31；Date 會把它滾成 3 月 3 日而不是 NaN）
  const datePart = candidate.slice(0, 10);
  if (!isValidDate(datePart)) return { ok: false };

  const year = Number(datePart.slice(0, 4));
  if (!Number.isInteger(year) || year < 2024 || year > 2100) return { ok: false };

  const ts = new Date(candidate).getTime();
  if (!Number.isFinite(ts)) return { ok: false };

  return { ok: true, value: new Date(ts).toISOString() };
}

/**
 * GET /api/admin/training/months
 * → { ok:true, months:[{ year, month, status, publish_at, effective_at, sessions_count, cancelled_count }] }
 *
 * 範圍：「近 24 個月」＝當月往前 12 個月到往後 11 個月。
 * 但在視窗外的「已發布」月份仍會列出 —— 否則客戶預先發布遠期月份後，
 * 那筆資料會從後台列表憑空消失，看起來像沒存到。
 */
export async function GET() {
  try {
    const auth = await authorizeAdmin();
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const current = currentMacauMonth();
    const currentIndex = monthIndex(current.year, current.month);
    const lowest = currentIndex - 12;
    const highest = currentIndex + 11;

    const { data: monthData, error: monthError } = await supabase
      .from("training_months")
      .select(MONTH_SELECT)
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .limit(LIMIT);

    if (monthError) return jsonTrainingDbError("GET /api/admin/training/months", monthError, MIGRATION);

    const rows = (monthData ?? []) as MonthRow[];
    const kept = rows.filter((row) => {
      const index = monthIndex(row.year, row.month);
      return (index >= lowest && index <= highest) || row.status === "published";
    });

    /* ---- 場次數：一次查區間再於記憶體分組 ----
     * 不逐月呼叫 month_stats RPC：24 個月 = 24 次往返，而這裡只要兩個數字。 */
    const counts = new Map<string, { total: number; cancelled: number }>();
    if (kept.length > 0) {
      const indexes = kept.map((row) => monthIndex(row.year, row.month));
      const first = fromMonthIndex(Math.min(...indexes));
      const last = fromMonthIndex(Math.max(...indexes));
      const from = monthBounds(first.year, first.month).from;
      const to = monthBounds(last.year, last.month).to;

      const { data: sessionData, error: sessionError } = await supabase
        .from("training_sessions")
        .select("session_date, status")
        .gte("session_date", from)
        .lte("session_date", to);

      if (sessionError) {
        return jsonTrainingDbError("GET /api/admin/training/months counts", sessionError, MIGRATION);
      }

      for (const row of (sessionData ?? []) as { session_date: string; status: string }[]) {
        const key = String(row.session_date).slice(0, 7);
        const bucket = counts.get(key) ?? { total: 0, cancelled: 0 };
        bucket.total += 1;
        if (row.status === "cancelled") bucket.cancelled += 1;
        counts.set(key, bucket);
      }
    }

    const months = kept
      .sort((a, b) => monthIndex(b.year, b.month) - monthIndex(a.year, a.month))
      .map((row) => {
        const bucket = counts.get(monthKey(row.year, row.month)) ?? { total: 0, cancelled: 0 };
        return {
          year: row.year,
          month: row.month,
          status: row.status,
          publish_at: row.publish_at,
          // 生效時間：publish_at 為空時就是該月 1 日 00:00 +08（與 SQL 判定一致）
          effective_at: row.publish_at ?? monthStartISO(row.year, row.month),
          sessions_count: bucket.total,
          cancelled_count: bucket.cancelled,
        };
      });

    return jsonOk({ months });
  } catch (err) {
    return jsonInternal("GET /api/admin/training/months", err);
  }
}

/**
 * POST /api/admin/training/months
 * body: { action:'publish'|'unpublish'|'update', year, month, publish_at?, note? }
 */
export async function POST(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if ("res" in auth) return auth.res;
    const { supabase, userId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const action = text(body.action);
    if (action !== "publish" && action !== "unpublish" && action !== "update") {
      return jsonValidation(
        { action: "不支援的操作。" },
        "不支援的操作，action 必須是 publish、unpublish 或 update。"
      );
    }

    const year = Number(body.year);
    if (!isIntInRange(year, 2024, 2100)) {
      return jsonValidation({ year: "年份需介於 2024 與 2100 之間。" }, "請選擇正確的年月。");
    }

    const month = Number(body.month);
    if (!isIntInRange(month, 1, 12)) {
      return jsonValidation({ month: "月份需介於 1 與 12 之間。" }, "請選擇正確的年月。");
    }

    const parsedPublishAt = parsePublishAt(body.publish_at);
    if (!parsedPublishAt.ok) {
      return jsonValidation(
        { publish_at: "發布時間格式錯誤，請用 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM。" },
        "請檢查表單內容。"
      );
    }

    let note: string | null = null;
    if (body.note !== undefined) {
      note = text(body.note) || null;
      if (note && note.length > NOTE_MAX) {
        return jsonValidation(
          { note: `備註過長（上限 ${NOTE_MAX} 字）。` },
          "請檢查表單內容。"
        );
      }
    }

    const { data: existingData, error: readError } = await supabase
      .from("training_months")
      .select("year, month, status, publish_at, note")
      .eq("year", year)
      .eq("month", month)
      .maybeSingle();

    if (readError) {
      return jsonTrainingDbError("POST /api/admin/training/months read", readError, MIGRATION);
    }

    const existing = (existingData as MonthRow | null) ?? null;
    if (action === "update" && !existing) {
      return jsonNotFound("找不到該月份的資料，請先發布或建立該月份。");
    }

    const nowIso = new Date().toISOString();
    const payload: Record<string, unknown> = { year, month, updated_at: nowIso };

    if (action === "publish") {
      payload.status = "published";
      // 沒給時間 → 該月 1 日 00:00 +08（客戶要的「12 月 1 日自動上架」）
      payload.publish_at = parsedPublishAt.value ?? monthStartISO(year, month);
    } else if (action === "unpublish") {
      payload.status = "draft";
      payload.publish_at = null;
    } else {
      // update：只動 publish_at / note，status 不動
      payload.status = existing?.status ?? "draft";
      if (body.publish_at === undefined) {
        payload.publish_at = existing?.publish_at ?? null;
      } else {
        payload.publish_at = parsedPublishAt.value;
      }
    }

    if (body.note !== undefined) payload.note = note;
    else if (!existing) payload.note = null;

    const { data: saved, error: writeError } = await supabase
      .from("training_months")
      .upsert(payload, { onConflict: "year,month" })
      .select("year, month, status, publish_at")
      .maybeSingle();

    if (writeError) {
      return jsonTrainingDbError("POST /api/admin/training/months upsert", writeError, MIGRATION);
    }

    const savedRow = (saved as MonthRow | null) ?? null;
    const effectiveAt = savedRow?.publish_at ?? monthStartISO(year, month);

    revalidateTrainingSchedule();

    const actionLabel =
      action === "publish" ? "發布" : action === "unpublish" ? "撤回" : "更新";
    await writeAuditLog(
      supabase,
      userId,
      "training",
      action,
      `${actionLabel} ${year} 年 ${month} 月班表（生效時間 ${effectiveAt}）`
    );

    const message =
      action === "publish"
        ? `已發布 ${year} 年 ${month} 月班表，生效時間 ${effectiveAt}。`
        : action === "unpublish"
          ? `已將 ${year} 年 ${month} 月班表改回草稿，前台不再顯示該月。`
          : `已更新 ${year} 年 ${month} 月班表的發布設定。`;

    return jsonOk({
      message,
      year,
      month,
      status: savedRow?.status ?? payload.status,
      publish_at: savedRow?.publish_at ?? null,
      effective_at: effectiveAt,
    });
  } catch (err) {
    return jsonInternal("POST /api/admin/training/months", err);
  }
}

/** 未實作的 HTTP 方法一律回 JSON（H6） */
export async function PUT() {
  return jsonMethodNotAllowed();
}

export async function DELETE() {
  return jsonMethodNotAllowed();
}
