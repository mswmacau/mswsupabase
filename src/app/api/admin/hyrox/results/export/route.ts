/**
 * GET /api/admin/hyrox/results/export — 完賽成績榜 CSV 匯出（管理員限定）
 *
 * 契約：docs/HYROX完賽排行榜與數據整合-方案-20261122.md §2.3 G-3 表第 3 行
 *       GET ?type=board
 *   → 200 text/csv; charset=utf-8（UTF-8 BOM；RFC5987 雙檔名；no-store）
 *
 * 匯出的是「公開榜」的口徑：只收 approved、排除 is_test、排除停用類別
 * （與 hyrox_results_public 檢視完全一致——站主拿這份檔去對外公佈時，
 * 內容跟網頁上看到的榜一模一樣，不會多出被拒絕或測試的成績）。
 * 名次在 server 算好（類別內完賽時間升冪），Excel 直接排不用再排。
 *
 * 【四個必查安全項】
 *   · 越權：authorizeAdmin()
 *   · 參數：type 只接受 board（預設 board），其餘 400 且有可讀訊息
 *   · 分頁：fetchAllPages 自己翻頁（500／批 + MAX_ROWS 硬上限）
 *   · 欄位白名單：絕不輸出 user_id／image_path／admin_note／電話
 *     （榜的本質是公開成績，不是個資名冊）
 *
 * 降級（§1.5-⑥）：migration 未跑（42P01 / PGRST205）→ 400 SCHEMA_OUTDATED。
 *
 * Owner：白客（backend-engineer）
 */

import { authorizeModule } from "@/lib/admin-guard";
import {
  jsonErr,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonValidation,
} from "@/lib/api";
import {
  csvCell,
  csvResponse,
  fetchAllPages,
  macauStamp,
  textCell,
  toCsv,
} from "@/lib/csv-export";

const EXPORT_TYPES = ["board"] as const;
type ExportType = (typeof EXPORT_TYPES)[number];

const TYPE_LABEL: Record<ExportType, string> = { board: "完賽排行榜" };

/** 單次匯出的列數上限 */
const MAX_ROWS = 20000;

/** PostgREST 回傳的原始列 */
type RawRow = {
  id: string;
  division_code: string;
  race_name: string;
  race_date: string;
  finish_seconds: number;
  team_name: string | null;
  teammates: unknown;
  created_at: string;
  profile: { display_name: string | null; is_test: boolean } | null;
  division: { label: string; is_active: boolean } | null;
};

const COLUMNS =
  "id,division_code,race_name,race_date,finish_seconds,team_name,teammates,created_at," +
  "profile:profiles!hyrox_results_user_id_fkey(display_name,is_test)," +
  "division:hyrox_divisions(label,is_active)";

export function POST() {
  return jsonMethodNotAllowed();
}
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;

export async function GET(request: Request) {
  try {
    /* ── 越權：第一行就擋 ─────────────────────────────────── */
    // 歸 review 模組（不是 events）：三支都只服務 /admin/review 的「HYROX 成績」分頁，
    // 與 hyrox/review 屬同一審核工作流；歸 events 會讓「UI 在 review、守衛在 events」脫節。
    const auth = await authorizeModule("review", { write: false });
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    /* ── 參數：type 只認列舉值（預設 board）──────────────── */
    const params = new URL(request.url).searchParams;
    const rawType = (params.get("type") ?? "board").trim();
    const type = (rawType === "" ? "board" : rawType) as ExportType;
    if (!(EXPORT_TYPES as readonly string[]).includes(type)) {
      return jsonValidation({ type: `匯出類型只接受 ${EXPORT_TYPES.join("／")}。` });
    }

    /* ── 取數：approved 全量，排序與公開榜一致（類別 → 時間 → id）── */
    const { rows, error } = await fetchAllPages<RawRow>({
      label: "完賽成績榜匯出",
      maxRows: MAX_ROWS,
      fetchPage: async (from, to) => {
        const { data, error: pageErr } = await supabase
          .from("hyrox_results")
          .select(COLUMNS)
          .eq("status", "approved")
          .order("division_code", { ascending: true })
          .order("finish_seconds", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        return { rows: (data as unknown as RawRow[]) ?? [], error: pageErr };
      },
    });

    if (error) {
      if (isSchemaMissing(error)) return schemaOutdated();
      return jsonInternal("GET /api/admin/hyrox/results/export list", error);
    }

    /* ── 對齊公開榜口徑：排除測試帳號與停用類別 ────────────── */
    const board = rows.filter(
      (r) => r.profile?.is_test !== true && r.division?.is_active !== false
    );

    /* ── 名次：類別內完賽時間升冪（server 算好，Excel 不用再排）──
       rows 已按 (division_code, finish_seconds, id) 排序，逐列遞增即可 */
    const rankByDivision = new Map<string, number>();
    for (const r of board) {
      const next = (rankByDivision.get(r.division_code) ?? 0) + 1;
      rankByDivision.set(r.division_code, next);
    }

    /* ── 組 CSV ───────────────────────────────────────────── */
    const header = [
      "名次",
      "比賽類別",
      "姓名",
      "隊伍名稱",
      "隊友",
      "完賽時間",
      "賽事名稱",
      "比賽日期",
    ];

    const body = board.map((r) => [
      csvCell(String(rankByDivision.get(r.division_code) ?? 0)),
      csvCell(r.division?.label ?? r.division_code),
      csvCell(r.profile?.display_name ?? ""),
      csvCell(r.team_name ?? ""),
      csvCell(
        (Array.isArray(r.teammates) ? (r.teammates as string[]) : []).join("、")
      ),
      textCell(formatFinish(r.finish_seconds)),
      csvCell(r.race_name),
      csvCell(r.race_date),
    ]);

    const csv = toCsv([header, ...body]);

    const stamp = macauStamp();
    const zhName = `HYROX-${TYPE_LABEL[type]}-${stamp}.csv`;
    const asciiName = `hyrox-results-${type}-${stamp}.csv`;

    return csvResponse({ csv, filenameZh: zhName, filenameAscii: asciiName });
  } catch (err) {
    return jsonInternal("GET /api/admin/hyrox/results/export", err);
  }
}

/* =============================================================
 * 內部工具
 * ============================================================= */

/** 完賽秒數 → HH:MM:SS（與名單端點同一格式） */
function formatFinish(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function isSchemaMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  if (code === "42P01" || code === "PGRST205") return true;
  return /does not exist|schema cache/i.test(message) && /hyrox_(results|divisions)/i.test(message);
}

function schemaOutdated() {
  return jsonErr("完賽排行榜尚未開放，請稍後再試。", "SCHEMA_OUTDATED", 400);
}
