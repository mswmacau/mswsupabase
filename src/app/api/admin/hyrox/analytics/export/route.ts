/**
 * GET /api/admin/hyrox/analytics/export — 戶外 HYROX 月度分析 CSV 匯出（管理員限定）
 *
 * 契約：docs/HYROX完賽排行榜與數據整合-方案-20261122.md §2.3 G-2／G-3 表第 7 行
 *       GET ?limit=12（1–36，預設 36）
 *   → 200 text/csv; charset=utf-8（UTF-8 BOM；RFC5987 雙檔名；no-store）
 *
 * 資料來源：RPC public.analytics_hyrox_monthly(p_limit)（migration-hyrox-analytics.sql）
 * —— 數據分析頁「戶外 HYROX 月度」區塊吃同一支 RPC，CSV 與頁面數字必然一致。
 *
 * 【四個必查安全項】
 *   · 越權：authorizeAdmin()（RPC 內另有 is_admin 閘門，雙重保險）
 *   · 參數：limit 鉗制 1–36（RPC 逾界會 raise，這裡先擋成 400 可讀訊息）
 *   · 分頁：RPC 一次回齊（p_limit ≤ 36 列），無分頁需求
 *   · 欄位白名單：只出聚合數字，沒有任何個資
 *
 * 降級（§1.5-⑥）：analytics migration 未跑（函式不存在，PostgREST 回
 * PGRST202 / 40404）→ 400 SCHEMA_OUTDATED，不讓站主看到裸 500。
 *
 * Owner：白客（backend-engineer）
 */

import { authorizeAdmin } from "@/lib/admin-guard";
import {
  jsonErr,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonValidation,
} from "@/lib/api";
import { csvCell, csvResponse, macauStamp, toCsv } from "@/lib/csv-export";

/** 與 RPC 的 p_limit 檢查同口徑（1–36） */
const LIMIT_MIN = 1;
const LIMIT_MAX = 36;
const LIMIT_DEFAULT = 36;

/** RPC 回傳的一列（鍵由 migration 固定，空資料時 months=[]） */
type MonthRow = {
  month: string;
  registrations: number;
  confirmed: number;
  confirm_rate: number;
  revenue_cents: number;
  returning_members: number;
  returning_rate: number;
};

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

    /* ── 參數：limit 鉗制 1–36 ───────────────────────────── */
    const params = new URL(request.url).searchParams;
    const rawLimit = (params.get("limit") ?? "").trim();
    let limit = LIMIT_DEFAULT;
    if (rawLimit !== "") {
      const n = Number(rawLimit);
      if (!Number.isInteger(n) || n < LIMIT_MIN || n > LIMIT_MAX) {
        return jsonValidation({ limit: `列數需為 ${LIMIT_MIN}–${LIMIT_MAX} 的整數。` });
      }
      limit = n;
    }

    /* ── 取數：與數據分析頁同一支 RPC ─────────────────────── */
    const { data, error } = await supabase.rpc("analytics_hyrox_monthly", {
      p_limit: limit,
    });

    if (error) {
      if (isRpcMissing(error)) return schemaOutdated();
      return jsonInternal("GET /api/admin/hyrox/analytics/export rpc", error);
    }

    // 形態契約：單列 jsonb 物件、months 是陣列（isRpcRow 同款判法）
    const payload = data as unknown as { months?: unknown } | null;
    if (typeof payload !== "object" || payload === null || !Array.isArray(payload.months)) {
      return jsonInternal("GET /api/admin/hyrox/analytics/export shape", payload);
    }

    const months = payload.months as MonthRow[];

    /* ── 組 CSV ───────────────────────────────────────────── */
    const header = [
      "月份",
      "報名數",
      "確認數",
      "確認率（%）",
      "收入（分）",
      "回頭會員數",
      "回頭率（%）",
    ];

    const body = months.map((m) => [
      csvCell(m.month),
      csvCell(String(m.registrations ?? 0)),
      csvCell(String(m.confirmed ?? 0)),
      csvCell(String(m.confirm_rate ?? 0)),
      csvCell(String(m.revenue_cents ?? 0)),
      csvCell(String(m.returning_members ?? 0)),
      csvCell(String(m.returning_rate ?? 0)),
    ]);

    const csv = toCsv([header, ...body]);

    const stamp = macauStamp();
    const zhName = `HYROX-月度分析-${stamp}.csv`;
    const asciiName = `hyrox-monthly-${stamp}.csv`;

    return csvResponse({ csv, filenameZh: zhName, filenameAscii: asciiName });
  } catch (err) {
    return jsonInternal("GET /api/admin/hyrox/analytics/export", err);
  }
}

/* =============================================================
 * 內部工具
 * ============================================================= */

/**
 * RPC 函式還沒建（analytics migration 未執行）的錯誤。
 * PGRST202 = schema cache 內找不到該函式；40404 = function not found。
 */
function isRpcMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  if (code === "PGRST202" || code === "40404") return true;
  return /analytics_hyrox_monthly/i.test(message) && /could not find|does not exist/i.test(message);
}

function schemaOutdated() {
  return jsonErr("這份分析還未開放，請先執行 supabase/migration-hyrox-analytics.sql。", "SCHEMA_OUTDATED", 400);
}
