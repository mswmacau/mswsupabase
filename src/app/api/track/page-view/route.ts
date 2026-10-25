/**
 * /api/track/page-view — 頁面停留追蹤（公開端點，不需登入）
 *
 * POST 收 { path, sid, dwell_ms, is_member? } → { ok: true }
 * 由前台的 navigator.sendBeacon 呼叫（方硯的 beacon 元件，T-22 前端部分）。
 *
 * 契約：《MSW 管理後台系統補強 — 分析與實施計劃 V2》§8.2 + §5.3
 * Owner：白客（backend-engineer）
 *
 * 設計要點（對應計劃條文）：
 *  - 公開端點：不檢查登入；以 anon client 插入，RLS page_views_insert_public
 *    放行（見 supabase/migration-analytics.sql 第 3 節）。
 *  - 兩種 body 都收：Content-Type: application/json，或 sendBeacon 常用的
 *    text/plain（內文為 JSON 字串）——一律讀純文字再 JSON.parse。
 *  - 60 秒去重：同一 sid+path 60 秒內重複上報靜默丟棄，仍回 { ok: true }
 *    （防 beacon 重試風暴，計劃 §5.3 第 6 點）。
 *  - 不記 IP / user_id / UA；只存聚合用途的匿名數據（計劃 §5.3 私隱紀律）。
 *
 * H6：全部包 try/catch，任何情況都回 JSON，不讓例外裸奔成 HTML 錯誤頁。
 */

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/env";
import { jsonBadJson, jsonInternal, jsonMethodNotAllowed, jsonOk, jsonValidation } from "@/lib/api";

/* =============================================================
 * 常數（與 migration-analytics.sql 的 check 約束逐字對齊）
 * ============================================================= */

/** 單次停留上限（毫秒）：30 分鐘，防忘記關分頁污染均值（計劃 §5.3 第 5 點） */
const MAX_DWELL_MS = 1_800_000;

/** 路徑白名單格式：斜線開頭 + 1–200 個英數字／底線／連字符／斜線 */
const PATH_RE = /^\/[A-Za-z0-9/_-]{0,200}$/;

/** sid 格式：8–32 小寫英數（客戶端 sessionStorage 隨機生成） */
const SID_RE = /^[a-z0-9]{8,32}$/;

/** 同一 sid+path 的去重視窗（毫秒） */
const DEDUP_WINDOW_MS = 60_000;

/** body 大小上限（位元組）：正常 payload 約 120 bytes，8KB 已很寬裕 */
const MAX_BODY_BYTES = 8_192;

/** DB 寫入超時（毫秒）：公開端點不能無限等待 Supabase */
const INSERT_TIMEOUT_MS = 8_000;

/** 去重表清掃門檻：超過就順手清掉過期鍵，避免長生命週期實例無限增長 */
const DEDUP_SWEEP_AT = 5_000;
/** 去重表硬頂：清掃後仍超過就整表重置（病理性格局防守） */
const DEDUP_HARD_CAP = 20_000;

/* =============================================================
 * 60 秒去重（模組級 Map）
 * ============================================================= */

/**
 * sid+path → 最近一次記錄時間（Date.now()）。
 *
 * ⚠️ 已知近似（如實標註）：這是「單一 serverless 實例內有效」的去重——
 * Vercel 多實例／多次冷啟動之間不共享狀態，同一 sid+path 可能在不同實例
 * 各插入一列。對聚合統計影響輕微（最壞是多算一次瀏覽），且 route handler
 * 的 insert 前校驗 + RLS check 已把傷害半徑限制在合法範圍內。
 * 若要嚴格去重需改用 Redis／DB unique 索引，屬未來優化，現在不做。
 */
const recentReports = new Map<string, number>();

/** 回傳 true 表示「60 秒內重複，應靜默丟棄」；否則記錄本次並回傳 false */
function isDuplicate(sid: string, path: string, now: number): boolean {
  const key = `${sid}\u0000${path}`;
  const last = recentReports.get(key);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return true;

  // 順手清掃：只在实际发生新写入且表變大時做，平常 O(1)
  if (recentReports.size >= DEDUP_SWEEP_AT) {
    for (const [k, ts] of recentReports) {
      if (now - ts >= DEDUP_WINDOW_MS) recentReports.delete(k);
    }
    if (recentReports.size >= DEDUP_HARD_CAP) recentReports.clear();
  }

  recentReports.set(key, now);
  return false;
}

/* =============================================================
 * Supabase 客戶端（追蹤專用，模組級快取）
 * ============================================================= */

let cachedClient: SupabaseClient | null = null;

/**
 * 追蹤專用的 anon 客戶端（角色仍是 anon，RLS page_views_insert_public 放行插入）。
 *
 * 與 src/lib/supabase/anon.ts 的差別只有一個：包一層帶 AbortSignal 超時的
 * fetch，讓 Supabase 掛住時這個公開端點能在 8 秒內回 JSON 500，不會無限等待
 * （寫入路徑的外部依賴要有超時設置；讀取路徑的共用客戶端刻意不動）。
 */
function trackClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;

  cachedClient ??= createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(INSERT_TIMEOUT_MS) }),
    },
  });

  return cachedClient;
}

/* =============================================================
 * body 解析（JSON 與 text/plain 皆收）
 * ============================================================= */

/**
 * 讀 body 並解析為物件；失敗回傳 null（呼叫端回 jsonBadJson）。
 *
 * 不用 lib/api.ts 的 readJson()：那邊沒有 body 大小上限，公開端點要擋
 * 「幾 MB 的垃圾 body」這種最簡單的濫寫。其餘行為（解析失敗／非物件 →
 * null）與 readJson 一致。
 */
async function readPayload(request: Request): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (text.length === 0 || text.length > MAX_BODY_BYTES) return null;

  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/* =============================================================
 * POST — 記錄一次頁面瀏覽
 * ============================================================= */
export async function POST(request: Request) {
  try {
    /* ---------- 1) 解析 body ---------- */
    const body = await readPayload(request);
    if (!body) return jsonBadJson();

    /* ---------- 2) 校驗（順序依計劃 §8.2；每個分支都有可讀中文錯誤）---------- */

    // path：必填、斜線開頭、不追蹤 /admin 與 /api、格式白名單
    const rawPath = body.path;
    if (typeof rawPath !== "string" || rawPath === "") {
      return jsonValidation({ path: "缺少頁面路徑。" });
    }
    const path = rawPath;
    if (!path.startsWith("/")) {
      return jsonValidation({ path: "頁面路徑需以 / 開頭。" });
    }
    if (path === "/admin" || path.startsWith("/admin/") || path === "/api" || path.startsWith("/api/")) {
      return jsonValidation({ path: "後台與 API 頁面不進行追蹤。" });
    }
    if (!PATH_RE.test(path)) {
      return jsonValidation({ path: "頁面路徑過長或含不支援的字元。" });
    }

    // sid：8–32 小寫英數（不 trim——格式就是契約，寬鬆只會污染去重鍵）
    const sid = body.sid;
    if (typeof sid !== "string" || !SID_RE.test(sid)) {
      return jsonValidation({ sid: "追蹤識別碼格式錯誤（8–32 位小寫英數）。" });
    }

    // dwell_ms：整數 0–1800000；另收純數字字串（舊式 beacon 可能送字串）
    const rawDwell = body.dwell_ms;
    let dwellMs: number;
    if (typeof rawDwell === "number") {
      dwellMs = rawDwell;
    } else if (typeof rawDwell === "string" && /^\d+$/.test(rawDwell)) {
      dwellMs = Number(rawDwell);
    } else {
      return jsonValidation({ dwell_ms: "停留時長格式錯誤（需為整數毫秒）。" });
    }
    if (!Number.isInteger(dwellMs) || dwellMs < 0) {
      return jsonValidation({ dwell_ms: "停留時長格式錯誤（需為 0 以上的整數）。" });
    }
    if (dwellMs > MAX_DWELL_MS) {
      return jsonValidation({ dwell_ms: "停留時長超出 30 分鐘上限。" });
    }

    // is_member：選填布林；缺鍵落 false（客戶端自報，僅粗略拆分，可被偽造）
    const rawMember = body.is_member;
    let isMember = false;
    if (rawMember !== undefined && rawMember !== null) {
      if (typeof rawMember !== "boolean") {
        return jsonValidation({ is_member: "會員標記格式錯誤（需為 true/false）。" });
      }
      isMember = rawMember;
    }

    /* ---------- 3) 60 秒去重：重複 → 靜默丟棄，仍回 ok ---------- */
    if (isDuplicate(sid, path, Date.now())) {
      return jsonOk();
    }

    /* ---------- 4) 插入（anon client，RLS 放行）---------- */
    const supabase = trackClient();
    if (!supabase) {
      // 未設定 Supabase（沙箱／本地開發）：無法寫入。回 JSON 錯誤而非拋出（H6），
      // 也絕不因為追蹤失敗影響前台——sendBeacon 本來就忽略回應。
      return jsonInternal("POST /api/track/page-view: Supabase 未設定");
    }

    const { error } = await supabase.from("page_views").insert({
      path,
      sid,
      dwell_ms: dwellMs,
      is_member: isMember,
      // id / day / created_at 由 DB 端產生（day 為 generated stored 欄位）
    });
    if (error) return jsonInternal("POST /api/track/page-view insert", error);

    return jsonOk();
  } catch (err) {
    return jsonInternal("POST /api/track/page-view", err);
  }
}

/* =============================================================
 * 其他方法：回 JSON 405，不讓框架回空 body（H6；复刻 checkins 路由）
 * ============================================================= */
export async function GET() {
  return jsonMethodNotAllowed();
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
