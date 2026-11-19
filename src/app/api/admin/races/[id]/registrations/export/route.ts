/**
 * /api/admin/races/[id]/registrations/export — 賽事名單 CSV 匯出（管理員限定）
 *
 * GET ?type=detail|logistics|summary（預設 detail）
 *   → 200 text/csv; charset=utf-8（開頭帶 UTF-8 BOM）
 *      Content-Disposition: attachment; filename="race-…csv"; filename*=UTF-8''<RFC5987>
 *      cache-control: no-store
 *
 * 【三種檔案，各有唯一用途】
 *   · detail（預設）：每位報名者一列。對帳、聯絡、核對付款狀態用。
 *   · logistics    ：只列「需要巴士或需要住宿」的人。直接寄給巴士公司／酒店。
 *   · summary      ：按「日期 × 組別」彙總，末列總計。給站主核對總數用。
 *
 * 【為什麼不用前端 fetch + blob】
 *   正式做法是 <a href="…" download>：瀏覽器自己下載，iOS Safari 不會吃掉檔案、
 *   也不會把幾千列的字串塞進 JS 記憶體。所以這一支必須是「GET 就能拿檔」。
 *
 * 【四個必查安全項】
 *   · 越權：authorizeAdmin()（未設定 400／未登入 401／非管理員 403）。
 *           匯出檔含姓名與電話，是全站最敏感的下載，權限一定在第一行擋。
 *   · IDOR：id 先 isUuid，再 loadRace() 確認 series='race'；不存在或屬於別的
 *           系列一律 404（不揭露別的模組的 id）。
 *   · 參數：type 只接受三個列舉值，其餘一律 400 且有可讀訊息（不會 500）。
 *   · 分頁：**匯出必須自己翻頁**。名單端點單次上限 200 且超量只回 truncated:true，
 *           所以這裡直接對資料表以 range() 分批 500 列迴圈取到拿不滿一批為止
 *           （PostgREST 預設 1000 列上限之下），並有 MAX_ROWS 硬上限與迴圈保險。
 *
 * 【絕對不輸出的欄位】
 *   user_id（匯出檔會外流，uid 可反查帳號）、payment_proof_path（原始路徑給人看
 *   沒有意義，也不該讓私有桶的物件路徑外流）。付款截圖欄改成「已上載／未上載」。
 *
 * 【與後台 UI 數字一致】
 *   三個檢視（race_summary / race_category_summary / race_logistics）都排除
 *   status='cancelled'，本檔的彙總與合計同樣排除，所以 summary 的總計列
 *   與後台彙總卡片對得上。detail 則保留 cancelled 並在「狀態」欄標明，
 *   讓站主看得到「誰被拒了」。
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
import { RACE_NOT_FOUND_MSG, dbFail, loadRace } from "@/app/api/admin/races/_shared";

type Ctx = { params: Promise<{ id: string }> };

/* =============================================================
 * 常數
 * ============================================================= */

const EXPORT_TYPES = ["detail", "logistics", "summary"] as const;
type ExportType = (typeof EXPORT_TYPES)[number];

const TYPE_LABEL: Record<ExportType, string> = {
  detail: "名單",
  logistics: "交通住宿",
  summary: "彙總",
};

/** 每批抓幾列（PostgREST 預設上限 1000，留一半餘裕，避免被截斷） */
const BATCH = 500;
/** 單次匯出的列數上限（超過就截斷並在 server log 留痕，不讓一次查詢拖垮資料庫） */
const MAX_ROWS = 20000;
/** 迴圈保險：正常 40 圈就到底，這裡給 60 */
const MAX_PAGES = 60;

const REG_STATUS_LABEL: Record<string, string> = {
  submitted: "待確認",
  confirmed: "已確認",
  needs_info: "需補資料",
  cancelled: "已拒絕／取消",
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  not_required: "免付款",
  pending: "待付款",
  approved: "已付款",
  rejected: "付款有問題",
};

const GENDER_LABEL: Record<string, string> = { male: "男", female: "女" };

/** 純數字電話（Excel 會把 0123456789 吃成 123456789，必須標成文字） */
const PURE_DIGITS = /^\d{4,}$/;

/* =============================================================
 * 資料型別
 * ============================================================= */

type RawRegistration = {
  id: string;
  full_name: string;
  phone: string;
  gender: "male" | "female" | null;
  needs_bus: boolean;
  bus_seats: number;
  needs_lodging: boolean;
  lodging_people: number;
  lodging_nights: number;
  payment_proof_path: string | null;
  payment_status: string;
  status: string;
  member_note: string | null;
  admin_note: string | null;
  created_at: string;
};

type RawEntry = {
  id: string;
  registration_id: string;
  category_id: string;
  teammate_names: string | null;
};

type RawCategory = {
  id: string;
  day: string;
  name: string;
};

const REGISTRATION_COLUMNS =
  "id,full_name,phone,gender,needs_bus,bus_seats,needs_lodging,lodging_people," +
  "lodging_nights,payment_proof_path,payment_status,status,member_note,admin_note,created_at";

const ENTRY_COLUMNS = "id,registration_id,category_id,teammate_names";

/* =============================================================
 * 方法限制（H6：非 GET 也要回 JSON，不回空 body）
 * ============================================================= */

export function POST() {
  return jsonMethodNotAllowed();
}

export function PATCH() {
  return jsonMethodNotAllowed();
}

export function DELETE() {
  return jsonMethodNotAllowed();
}

export function PUT() {
  return jsonMethodNotAllowed();
}

/* =============================================================
 * GET
 * ============================================================= */

export async function GET(request: Request, ctx: Ctx) {
  try {
    /* ── 越權：第一行就擋 ─────────────────────────────────── */
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    /* ── IDOR 第一道：格式 ───────────────────────────────── */
    const { id } = await ctx.params;
    const eventId = (id ?? "").trim();
    if (!isUuid(eventId)) return jsonValidation({ id: "賽事編號格式錯誤。" });

    /* ── 參數：type 只認三個列舉值 ───────────────────────── */
    const params = new URL(request.url).searchParams;
    const rawType = (params.get("type") ?? "").trim();
    const type = (rawType === "" ? "detail" : rawType) as ExportType;
    if (!(EXPORT_TYPES as readonly string[]).includes(type)) {
      return jsonValidation({ type: `匯出類型只接受 ${EXPORT_TYPES.join("／")}。` });
    }

    /* ── IDOR 第二道：必須是賽事（series='race'）──────────── */
    const { row: event, error: guardErr } = await loadRace(supabase, eventId);
    if (guardErr) return dbFail("GET /api/admin/races/[id]/registrations/export guard", guardErr);
    if (!event) return jsonNotFound(RACE_NOT_FOUND_MSG);

    /* ── 取數：自己翻頁（分批 500 直到拿不滿一批）─────────── */
    const regsResult = await fetchAllRegistrations(supabase, eventId);
    if (regsResult.error) {
      return dbFail("GET /api/admin/races/[id]/registrations/export list", regsResult.error);
    }
    const registrations = regsResult.rows;

    const catResult = await fetchCategories(supabase, eventId);
    if (catResult.error) {
      return dbFail("GET /api/admin/races/[id]/registrations/export categories", catResult.error);
    }
    const categories = catResult.rows;

    const entryResult = await fetchAllEntries(supabase, eventId);
    if (entryResult.error) {
      return dbFail("GET /api/admin/races/[id]/registrations/export entries", entryResult.error);
    }
    const entries = entryResult.rows;

    /* ── 組 CSV ───────────────────────────────────────────── */
    const csv =
      type === "detail"
        ? buildDetailCsv(event, registrations, entries, categories)
        : type === "logistics"
          ? buildLogisticsCsv(registrations)
          : buildSummaryCsv(registrations, entries, categories);

    /* BOM 一定要在「字串最前面」，否則 Excel 會用系統 ANSI 解 UTF-8 → 中文亂碼 */
    const body = `\uFEFF${csv}`;

    const stamp = macauStamp(new Date());
    const zhName = `${sanitizeFilePart(event.title)}-${TYPE_LABEL[type]}-${stamp}.csv`;
    const asciiName = `race-${type}-${stamp}.csv`;

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${rfc5987(zhName)}`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    return jsonInternal("GET /api/admin/races/[id]/registrations/export", err);
  }
}

/* =============================================================
 * 取數（全部自己翻頁，不依賴呼叫端的 page／size）
 * ============================================================= */

type FetchResult<T> = { rows: T[]; error: unknown };

async function fetchAllRegistrations(
  supabase: Parameters<typeof loadRace>[0],
  eventId: string
): Promise<FetchResult<RawRegistration>> {
  const out: RawRegistration[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * BATCH;
    const { data, error } = await supabase
      .from("race_registrations")
      .select(REGISTRATION_COLUMNS)
      .eq("event_id", eventId)
      // created_at 可能同秒，補 id 排序才不會有列在分頁邊界被跳過／重複
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + BATCH - 1);

    if (error) return { rows: out, error };

    const batch = (data as unknown as RawRegistration[] | null) ?? [];
    out.push(...batch);
    if (batch.length < BATCH) return { rows: out, error: null };
    if (out.length >= MAX_ROWS) {
      console.warn(
        `[api] 賽事匯出列數達上限 ${MAX_ROWS}（event ${eventId}），後續列未匯出。`
      );
      return { rows: out, error: null };
    }
  }

  return { rows: out, error: null };
}

async function fetchAllEntries(
  supabase: Parameters<typeof loadRace>[0],
  eventId: string
): Promise<FetchResult<RawEntry>> {
  const out: RawEntry[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * BATCH;
    const { data, error } = await supabase
      .from("race_entries")
      // 用 inner join 過濾到本場賽事，避免先撈 registration_id 清單再塞 .in()
      .select(`${ENTRY_COLUMNS},race_registrations!inner(event_id)`)
      .eq("race_registrations.event_id", eventId)
      .order("id", { ascending: true })
      .range(from, from + BATCH - 1);

    if (error) return { rows: out, error };

    const batch = (data as unknown as RawEntry[] | null) ?? [];
    out.push(...batch);
    if (batch.length < BATCH) return { rows: out, error: null };
  }

  return { rows: out, error: null };
}

async function fetchCategories(
  supabase: Parameters<typeof loadRace>[0],
  eventId: string
): Promise<FetchResult<RawCategory>> {
  const { data, error } = await supabase
    .from("race_categories")
    .select("id,day,name")
    .eq("event_id", eventId)
    .order("day", { ascending: true })
    .order("name", { ascending: true })
    .limit(BATCH);

  if (error) return { rows: [], error };
  return { rows: (data as unknown as RawCategory[] | null) ?? [], error: null };
}

/* =============================================================
 * CSV 產生
 * ============================================================= */

/**
 * CSV 儲存格跳脫：含逗號／雙引號／換行就用雙引號包起來，內部 " 變成 ""。
 * 這是 RFC 4180，Excel／LibreOffice／Numbers／Google Sheets 都吃。
 */
function csvCell(raw: unknown): string {
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
function textCell(value: string | null | undefined): string {
  const s = (value ?? "").trim();
  if (s === "") return "";
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return `="${s}"`;
}

/**
 * 電話欄。純數字（有前導 0 的風險）強制成文字；含 +／空格／- 的號碼
 * （例如 +853 6666 7777）Excel 本來就只會當文字，照一般規則跳脫即可。
 */
function phoneCell(phone: string | null | undefined): string {
  const p = (phone ?? "").trim();
  if (p === "") return "";
  if (PURE_DIGITS.test(p)) return textCell(p);
  return csvCell(p);
}

function toCsv(rows: string[][]): string {
  // CRLF：Excel 對 LF-only 的舊版本相容性較差
  return `${rows.map((r) => r.join(",")).join("\r\n")}\r\n`;
}

/** YYYY-MM-DD → MM/DD（組別日期前綴，例：02/01；與後台 UI 的 raceDayLabel 同一個寫法） */
function mdOf(day: string): string {
  return `${day.slice(5, 7)}/${day.slice(8, 10)}`;
}

/** YYYY-MM-DD → YYYY/MM/DD（給人看的日期） */
function slashDate(day: string): string {
  return day.replaceAll("-", "/");
}

/** 賽事日期範圍：單日 → 2027/02/01；跨日 → 2027/02/01 – 2027/02/03 */
function dateRangeLabel(start: string, end: string | null): string {
  if (!end || end === start) return slashDate(start);
  return `${slashDate(start)} – ${slashDate(end)}`;
}

/** timestamptz → 澳門時間 YYYY-MM-DD HH:mm（匯出檔的時間一律用澳門時間，避免誤讀） */
function macauDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Macau",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** 檔名用的日期戳：澳門時間 YYYYMMDD */
function macauStamp(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Macau",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

/** 檔名去掉作業系統／瀏覽器不接受的符號與空白，並限長 */
function sanitizeFilePart(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|\r\n\t]/g, "")
    .replace(/\s+/g, "")
    .slice(0, 60);
  return cleaned === "" ? "賽事" : cleaned;
}

/** RFC 5987 編碼（encodeURIComponent 不會轉 ' ( ) *，要自己補） */
function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/* =============================================================
 * detail：每位報名者一列
 * ============================================================= */

function buildDetailCsv(
  event: { title: string; event_date: string; end_date: string | null },
  registrations: RawRegistration[],
  entries: RawEntry[],
  categories: RawCategory[]
): string {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const byReg = groupEntries(entries, catMap);

  const header = [
    "日期",
    "姓名",
    "性別",
    "電話",
    "參賽項目",
    "隊友",
    "需要巴士",
    "巴士座位",
    "需要住宿",
    "住宿人數",
    "住宿晚數",
    "狀態",
    "付款狀態",
    "付款截圖",
    "備註",
    "建立時間",
  ];

  const rows: string[][] = [header];

  for (const r of registrations) {
    const list = byReg.get(r.id) ?? [];

    // 參賽項目：11/21 Men Open；11/22 Women Open（多項用全形分號）
    const items = list
      .map((e) => {
        const cat = catMap.get(e.category_id);
        if (!cat) return "（組別已刪除）";
        return `${mdOf(cat.day)} ${cat.name}`;
      })
      .join("；");

    const teammates =
      list
        .map((e) => (e.teammate_names ?? "").trim())
        .filter((s) => s !== "")
        .join("；") || "";

    // 備註：參賽者備註 + 後台備註（後台備註是站主自己寫的處理紀錄，對帳時要看）
    const noteParts: string[] = [];
    if (r.member_note && r.member_note.trim() !== "") noteParts.push(r.member_note.trim());
    if (r.admin_note && r.admin_note.trim() !== "")
      noteParts.push(`後台：${r.admin_note.trim()}`);

    rows.push([
      csvCell(dateRangeLabel(event.event_date, event.end_date)),
      csvCell(r.full_name),
      csvCell(r.gender ? (GENDER_LABEL[r.gender] ?? r.gender) : "未填"),
      phoneCell(r.phone),
      csvCell(items),
      csvCell(teammates),
      csvCell(r.needs_bus ? "是" : "否"),
      csvCell(r.needs_bus ? String(r.bus_seats ?? 0) : ""),
      csvCell(r.needs_lodging ? "是" : "否"),
      csvCell(r.needs_lodging ? String(r.lodging_people ?? 0) : ""),
      csvCell(r.needs_lodging ? String(r.lodging_nights ?? 0) : ""),
      csvCell(REG_STATUS_LABEL[r.status] ?? r.status),
      csvCell(PAYMENT_STATUS_LABEL[r.payment_status] ?? r.payment_status),
      // 只給「已上載／未上載」——私有桶物件路徑不外流
      csvCell(r.payment_proof_path ? "已上載" : "未上載"),
      csvCell(noteParts.join("｜")),
      // 建立時間強制成文字：Excel 會把 YYYY-MM-DD HH:mm 轉成日期，欄寬不足顯示 ####
      textCell(macauDateTime(r.created_at)),
    ]);
  }

  return toCsv(rows);
}

/* =============================================================
 * logistics：只列需要交通／住宿的人（直接寄給巴士公司、酒店）
 * ============================================================= */

function buildLogisticsCsv(registrations: RawRegistration[]): string {
  const rows: string[][] = [["姓名", "電話", "巴士", "住宿", "備註"]];

  let busSeats = 0;
  let lodgingPeople = 0;
  let lodgingNights = 0;

  const needLogistics = registrations
    .filter((r) => r.status !== "cancelled")
    .filter((r) => r.needs_bus || r.needs_lodging);

  for (const r of needLogistics) {
    const busText = r.needs_bus ? `${r.bus_seats ?? 0}` : "";
    const lodgingText = r.needs_lodging
      ? `${r.lodging_people ?? 0} 人 ${r.lodging_nights ?? 0} 晚`
      : "";

    if (r.needs_bus) busSeats += Number(r.bus_seats ?? 0);
    if (r.needs_lodging) {
      lodgingPeople += Number(r.lodging_people ?? 0);
      lodgingNights += Number(r.lodging_nights ?? 0);
    }

    rows.push([
      csvCell(r.full_name),
      phoneCell(r.phone),
      csvCell(busText),
      csvCell(lodgingText),
      // 對外文件只帶參賽者自己的備註，不帶站主的內部備註
      csvCell(r.member_note ?? ""),
    ]);
  }

  rows.push([
    csvCell("合計"),
    "",
    csvCell(`${busSeats} 座位`),
    csvCell(`${lodgingPeople} 人 ${lodgingNights} 晚`),
    "",
  ]);

  return toCsv(rows);
}

/* =============================================================
 * summary：日期 × 組別，末列總計
 * ============================================================= */

function buildSummaryCsv(
  registrations: RawRegistration[],
  entries: RawEntry[],
  categories: RawCategory[]
): string {
  const alive = new Map(
    registrations.filter((r) => r.status !== "cancelled").map((r) => [r.id, r])
  );
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const byReg = groupEntries(entries, catMap);

  /**
   * 巴士／住宿是「人的需求」，不是「組別的需求」。
   * 同一個人跑兩個組別時若兩列都計，加總就會是他的兩倍。
   * 所以只計在「他最早的那個組別」那一列（見 sortedEntries），
   * 這樣各列相加 == 總計列 == 後台 race_logistics 的數字。
   */
  type Agg = {
    category: RawCategory;
    people: Set<string>;
    entries: number;
    busSeats: number;
    lodgingPeople: number;
    lodgingNights: number;
  };

  const aggs = new Map<string, Agg>();
  for (const c of categories) {
    aggs.set(c.id, {
      category: c,
      people: new Set<string>(),
      entries: 0,
      busSeats: 0,
      lodgingPeople: 0,
      lodgingNights: 0,
    });
  }

  /* 每人一次：把他的巴士／住宿記到最早的組別上 */
  for (const [regId, reg] of alive) {
    const list = byReg.get(regId) ?? [];
    const first = list[0]; // groupEntries 已依 (day, name) 排好
    if (!first) continue;
    const agg = aggs.get(first.category_id);
    if (!agg) continue;
    if (reg.needs_bus) agg.busSeats += Number(reg.bus_seats ?? 0);
    if (reg.needs_lodging) {
      agg.lodgingPeople += Number(reg.lodging_people ?? 0);
      agg.lodgingNights += Number(reg.lodging_nights ?? 0);
    }
  }

  /* 人次與人數：組別層（與 race_category_summary 同口徑） */
  for (const [regId, reg] of alive) {
    const list = byReg.get(regId) ?? [];
    for (const e of list) {
      const agg = aggs.get(e.category_id);
      if (!agg) continue;
      agg.entries += 1;
      agg.people.add(reg.id);
    }
  }

  const rows: string[][] = [
    ["日期", "組別", "人數", "人次", "巴士座位", "住宿人數", "住宿晚數"],
  ];

  const ordered = Array.from(aggs.values()).sort((a, b) => {
    const da = a.category.day;
    const db = b.category.day;
    if (da !== db) return da < db ? -1 : 1;
    return a.category.name < b.category.name ? -1 : a.category.name > b.category.name ? 1 : 0;
  });

  for (const agg of ordered) {
    rows.push([
      csvCell(slashDate(agg.category.day)),
      csvCell(agg.category.name),
      csvCell(String(agg.people.size)),
      csvCell(String(agg.entries)),
      csvCell(String(agg.busSeats)),
      csvCell(String(agg.lodgingPeople)),
      csvCell(String(agg.lodgingNights)),
    ]);
  }

  /* 總計：人數與需求一律「去重」，所以會小於或等於各列相加（同人跑多組時） */
  let totalBusSeats = 0;
  let totalLodgingPeople = 0;
  let totalLodgingNights = 0;
  for (const reg of alive.values()) {
    if (reg.needs_bus) totalBusSeats += Number(reg.bus_seats ?? 0);
    if (reg.needs_lodging) {
      totalLodgingPeople += Number(reg.lodging_people ?? 0);
      totalLodgingNights += Number(reg.lodging_nights ?? 0);
    }
  }
  const totalEntries = Array.from(aggs.values()).reduce((s, a) => s + a.entries, 0);

  rows.push([
    csvCell("總計（去重）"),
    "",
    csvCell(String(alive.size)),
    csvCell(String(totalEntries)),
    csvCell(String(totalBusSeats)),
    csvCell(String(totalLodgingPeople)),
    csvCell(String(totalLodgingNights)),
  ]);

  return toCsv(rows);
}

/* =============================================================
 * 內部工具
 * ============================================================= */

/**
 * 依 registration_id 分組，並把同一人的多個組別依 (day, name) 排序。
 * 排序很重要：summary 要用「最早的那個組別」來掛巴士／住宿，
 * detail 的「參賽項目」也要穩定順序（同一個人每次匯出的欄位內容一致）。
 */
function groupEntries(
  entries: RawEntry[],
  catMap: Map<string, RawCategory>
): Map<string, RawEntry[]> {
  const map = new Map<string, RawEntry[]>();
  for (const e of entries) {
    const list = map.get(e.registration_id) ?? [];
    list.push(e);
    map.set(e.registration_id, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      const ca = catMap.get(a.category_id);
      const cb = catMap.get(b.category_id);
      const da = ca?.day ?? "9999-99-99";
      const db = cb?.day ?? "9999-99-99";
      if (da !== db) return da < db ? -1 : 1;
      const na = ca?.name ?? "";
      const nb = cb?.name ?? "";
      if (na !== nb) return na < nb ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }
  return map;
}
