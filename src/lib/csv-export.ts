/**
 * src/lib/csv-export.ts — 管理端 CSV 匯出的共用模組（方案 §2.3 G-3）
 *
 * Owner：白客（backend-engineer）。邏輯逐字抽自
 * src/app/api/admin/races/[id]/registrations/export/route.ts（該路由是本站
 * 第一個 CSV 匯出，四個細節都在那裡踩實過）；之後每個域的匯出照抄本檔，
 * 不要在各自路由裡再寫一份 escape／檔名編碼。
 *
 * 【統一規則（G-3 定案）】
 *   · BOM（\uFEFF）一定在字串最前面——否則 Excel 用系統 ANSI 解 UTF-8，
 *     中文全部亂碼
 *   · RFC 4180 escape：含逗號／雙引號／換行就用雙引號包起來，內部 " → ""
 *   · RFC 5987 雙檔名：filename="ascii.csv"; filename*=UTF-8''<編碼>
 *     （中文檔名在 Safari／舊瀏覽器不吃 filename=，一定要雙寫）
 *   · cache-control: no-store（匯出檔含個資，不可進任何快取）
 *   · 日期 ISO／澳門時間；金額一律 cents 整數
 *
 * 【為什麼 server 組字串、不經 client】
 *   <a href="…" download> 讓瀏覽器自己下載：iOS Safari 不會吃掉檔案，
 *   也不會把幾千列塞進 JS 記憶體；權限只在 server 判一次（authorizeAdmin）。
 */

/* =============================================================
 * 儲存格層
 * ============================================================= */

/**
 * CSV 儲存格跳脫：含逗號／雙引號／換行就用雙引號包起來，內部 " 變成 ""。
 * 這是 RFC 4180，Excel／LibreOffice／Numbers／Google Sheets 都吃。
 */
export function csvCell(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const s = String(raw);
  if (s === "") return "";
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * 強制成文字的儲存格。
 *
 * 【為什麼需要】
 * Excel 開 CSV 會自作聰明：`0123456789` 變 123456789（前導 0 消失）、
 * `2026-11-20 00:19` 變日期序號（欄寬不足就顯示成一排 ####）。
 * 用 `="…"` 讓 Excel／LibreOffice／Numbers 都當成文字公式，儲存格顯示的值
 * 與檔案裡的字面值完全一致（實測 Excel 16：儲存格顯示 0123456789，
 * 編輯列顯示 ="0123456789"）。
 *
 * 代價：用 grep／程式解析時會看到 ="…" 這串字面值（見交付說明的限制）。
 */
export function textCell(value: string | null | undefined): string {
  const s = (value ?? "").trim();
  if (s === "") return "";
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return `="${s}"`;
}

/** 純數字電話（Excel 會把前導 0 吃掉，必須標成文字） */
const PURE_DIGITS = /^\d{4,}$/;

/**
 * 電話欄。純數字（有前導 0 的風險）強制成文字；含 +／空格／- 的號碼
 * （例如 +853 6666 7777）Excel 本來就只會當文字，照一般規則跳脫即可。
 */
export function phoneCell(phone: string | null | undefined): string {
  const p = (phone ?? "").trim();
  if (p === "") return "";
  if (PURE_DIGITS.test(p)) return textCell(p);
  return csvCell(p);
}

/** 二維陣列 → CSV 本文。CRLF：Excel 對 LF-only 的舊版本相容性較差 */
export function toCsv(rows: string[][]): string {
  return `${rows.map((r) => r.join(",")).join("\r\n")}\r\n`;
}

/* =============================================================
 * 時間與檔名
 * ============================================================= */

const MACAU_TZ = "Asia/Macau";

function macauParts(d: Date, withTime: boolean) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MACAU_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).formatToParts(d);
}

function pickPart(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/** timestamptz → 澳門時間 YYYY-MM-DD HH:mm（匯出檔的時間一律用澳門時間，避免誤讀） */
export function macauDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = macauParts(d, true);
  return `${pickPart(parts, "year")}-${pickPart(parts, "month")}-${pickPart(
    parts,
    "day"
  )} ${pickPart(parts, "hour")}:${pickPart(parts, "minute")}`;
}

/** 檔名用的日期戳：澳門時間 YYYYMMDD */
export function macauStamp(d: Date = new Date()): string {
  const parts = macauParts(d, false);
  return `${pickPart(parts, "year")}${pickPart(parts, "month")}${pickPart(parts, "day")}`;
}

/** 檔名去掉作業系統／瀏覽器不接受的符號與空白，並限長 */
export function sanitizeFilePart(title: string, fallback = "匯出"): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|\r\n\t]/g, "")
    .replace(/\s+/g, "")
    .slice(0, 60);
  return cleaned === "" ? fallback : cleaned;
}

/** RFC 5987 編碼（encodeURIComponent 不會轉 ' ( ) *，要自己補） */
export function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/* =============================================================
 * 回應層
 * ============================================================= */

/**
 * 組好下載回應：BOM 在最前、雙檔名、不進快取、不當 HTML 嗅探。
 *
 * @param csv      CSV 本文（不含 BOM；本函式會加）
 * @param filenameZh   給人看的檔名（中文，走 RFC5987）
 * @param filenameAscii 舊瀏覽器／不支援 RFC5987 時的 ASCII 後備檔名
 */
export function csvResponse(args: {
  csv: string;
  filenameZh: string;
  filenameAscii: string;
}): Response {
  // BOM 一定要在「字串最前面」，否則 Excel 會用系統 ANSI 解 UTF-8 → 中文亂碼
  const body = `\uFEFF${args.csv}`;

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${args.filenameAscii}"; filename*=UTF-8''${rfc5987(
        args.filenameZh
      )}`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/* =============================================================
 * 取數層：匯出專用的分頁迴圈
 * ============================================================= */

/** 每批抓幾列（PostgREST 預設上限 1000，留一半餘裕，避免被截斷） */
export const CSV_BATCH = 500;

/**
 * 匯出必須自己翻頁：列表端點有單頁上限且超量只回 truncated，
 * 直接照抄會靜默截斷。分批取到「拿不滿一批」為止。
 *
 * @param fetchPage (from, to) → { rows, error }；呼叫端用 supabase …range(from, to)
 * @param maxRows   硬上限（超過就停並在 server log 留痕，不讓一次匯出拖垮資料庫）
 * @param maxPages  迴圈保險（預設 maxRows/BATCH + 20 圈）
 * @param label     server log 用的標籤
 */
export async function fetchAllPages<T>(args: {
  fetchPage: (from: number, to: number) => Promise<{ rows: T[]; error: unknown }>;
  maxRows?: number;
  maxPages?: number;
  label?: string;
}): Promise<{ rows: T[]; error: unknown }> {
  const maxRows = args.maxRows ?? 20000;
  const maxPages = args.maxPages ?? Math.ceil(maxRows / CSV_BATCH) + 20;
  const label = args.label ?? "csv 匯出";

  const out: T[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const from = page * CSV_BATCH;
    const { rows: batch, error } = await args.fetchPage(from, from + CSV_BATCH - 1);
    if (error) return { rows: out, error };

    out.push(...batch);
    if (batch.length < CSV_BATCH) return { rows: out, error: null };
    if (out.length >= maxRows) {
      console.warn(`[api] ${label}列數達上限 ${maxRows}，後續列未匯出。`);
      return { rows: out, error: null };
    }
  }

  return { rows: out, error: null };
}
