/**
 * /api/admin/events/[id]/album-links — 活動相簿多連結管理（管理員限定）
 *
 * 契約：docs/HYROX完賽排行榜與數據整合-方案-20261122.md §3.2／任務 B-08
 *   GET    → 該場活動的連結清單（sort_order 升冪）
 *   POST   { url, label, sort_order? } → 新增一筆（每場上限 5 筆；只收 http/https）
 *   DELETE { id } → 刪一筆
 *
 * 設計要點：
 *   · events.album_url（migration-races.sql §1）保持「主相簿」大按鈕不動，
 *     本表是按鈕列；舊資料零遷移。
 *   · 不限 series：表名與 FK 都是對 events 整體（賽事頁先用，HYROX 場次
 *     日後要掛多個攝影師連結也直接用，不用改這支）。
 *   · 前台一律外開新視窗（X-Frame-Options 全網雲相簿都會擋 iframe），
 *     這是前台渲染的事，API 只負責存 https 連結。
 *
 * 【四個必查安全項】
 *   · 越權：authorizeAdmin()（寫入只有管理員；讀取另有
 *           album_links_select_all 公開政策給前台）
 *   · IDOR：id 先 isUuid；刪除時同時比對 link.event_id = 路徑上的活動 id
 *           （不能拿 A 場的連結 id 去刪 B 場的）
 *   · 參數：url 只收 http/https 且 ≤500 字；label 1–40 字；sort_order
 *           −9999–9999；上限 5 筆（409 可讀訊息）
 *   · 分頁：單場最多 5 筆，無分頁需求
 *
 * 降級（§1.5-⑥ 同精神）：migration 未跑（event_album_links 不存在）→
 * 400 SCHEMA_OUTDATED，不讓 RaceForm 看到裸 500。
 *
 * Owner：白客（backend-engineer）
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { authorizeAdmin } from "@/lib/admin-guard";
import {
  isUuid,
  jsonConflict,
  jsonErr,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";
import { RACES_TAG } from "@/lib/races";

type Ctx = { params: Promise<{ id: string }> };

/** 每場活動的連結上限（方案 §3.2：0–5 筆） */
const MAX_LINKS = 5;

const URL_RE = /^https?:\/\//i;
const URL_MAX = 500;
const LABEL_MAX = 40;
const SORT_MIN = -9999;
const SORT_MAX = 9999;

/** PostgREST 回傳的原始列 */
type RawLink = {
  id: string;
  event_id: string;
  url: string;
  label: string;
  sort_order: number;
  created_at: string;
};

const COLUMNS = "id,event_id,url,label,sort_order,created_at";

export async function PUT() {
  return jsonMethodNotAllowed();
}
export const PATCH = PUT;

/* =============================================================
 * GET — 連結清單（RaceForm 載入與新增／刪除後刷新用）
 * ============================================================= */

export async function GET(request: Request, ctx: Ctx) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    const { id } = await ctx.params;
    const eventId = (id ?? "").trim();
    if (!isUuid(eventId)) return jsonValidation({ id: "活動編號格式錯誤。" });

    const { data, error } = await supabase
      .from("event_album_links")
      .select(COLUMNS)
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(MAX_LINKS);

    if (error) {
      if (isSchemaMissing(error)) return schemaOutdated();
      return jsonInternal("GET /api/admin/events/[id]/album-links", error);
    }

    return jsonOk({ links: (data as unknown as RawLink[]) ?? [] });
  } catch (err) {
    return jsonInternal("GET /api/admin/events/[id]/album-links", err);
  }
}

/* =============================================================
 * POST — 新增一筆連結（上限 5；只收 http/https）
 * ============================================================= */

export async function POST(request: Request, ctx: Ctx) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    const { id } = await ctx.params;
    const eventId = (id ?? "").trim();
    if (!isUuid(eventId)) return jsonValidation({ id: "活動編號格式錯誤。" });

    const body = await readJson(request);
    if (!body) return jsonValidation({}, "資料格式錯誤。");

    /* --- url：只收 http/https（擋 javascript:／data: 等注入向量）--- */
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) return jsonValidation({ url: "請填寫相簿連結。" });
    if (!URL_RE.test(url) || url.length > URL_MAX) {
      return jsonValidation({ url: "連結必須以 http(s):// 開頭，且不超過 500 字。" });
    }

    /* --- label --- */
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (label.length < 1 || label.length > LABEL_MAX) {
      return jsonValidation({ label: `連結名稱需為 1–${LABEL_MAX} 個字。` });
    }

    /* --- sort_order：選填；沒給就接在現有最後一筆之後（+10）--- */
    let sortOrder: number | null = null;
    if (body.sort_order !== undefined && body.sort_order !== null) {
      const n = Number(body.sort_order);
      if (!Number.isInteger(n) || n < SORT_MIN || n > SORT_MAX) {
        return jsonValidation({ sort_order: `排序需為 ${SORT_MIN}–${SORT_MAX} 的整數。` });
      }
      sortOrder = n;
    }

    /* --- 活動必須存在（FK 之外的第二道防線，錯誤訊息可讀）--- */
    const { data: event, error: eventErr } = await supabase
      .from("events")
      .select("id, title")
      .eq("id", eventId)
      .maybeSingle();

    if (eventErr) {
      return jsonInternal("POST /api/admin/events/[id]/album-links read event", eventErr);
    }
    if (!event) return jsonNotFound("找不到這筆活動。");

    /* --- 上限 5 筆（先查後插，順便帶回現有最大 sort_order）--- */
    const { data: existing, error: countErr } = await supabase
      .from("event_album_links")
      .select("id, sort_order")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true })
      .limit(MAX_LINKS + 1);

    if (countErr) {
      if (isSchemaMissing(countErr)) return schemaOutdated();
      return jsonInternal("POST /api/admin/events/[id]/album-links count", countErr);
    }

    const rows = (existing as unknown as Array<{ id: string; sort_order: number }>) ?? [];
    if (rows.length >= MAX_LINKS) {
      return jsonConflict(`每場活動最多 ${MAX_LINKS} 個相簿連結。`);
    }

    if (sortOrder === null) {
      const maxSort = rows.reduce((m, r) => Math.max(m, Number(r.sort_order ?? 0)), 0);
      sortOrder = Math.min(maxSort + 10, SORT_MAX);
    }

    /* --- 寫入（RLS：album_links_admin_all 只放行管理員）--- */
    const { data: link, error: insertErr } = await supabase
      .from("event_album_links")
      .insert({ event_id: eventId, url, label, sort_order: sortOrder })
      .select(COLUMNS)
      .single();

    if (insertErr) {
      if (isSchemaMissing(insertErr)) return schemaOutdated();
      return jsonInternal("POST /api/admin/events/[id]/album-links insert", insertErr);
    }

    revalidateTag(RACES_TAG, { expire: 60 });
    revalidatePath("/events");

    return jsonOk({ link: link as unknown as RawLink }, 201);
  } catch (err) {
    return jsonInternal("POST /api/admin/events/[id]/album-links", err);
  }
}

/* =============================================================
 * DELETE — 刪一筆連結（同時比對所屬活動，防跨活動刪除）
 * ============================================================= */

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    const { id } = await ctx.params;
    const eventId = (id ?? "").trim();
    if (!isUuid(eventId)) return jsonValidation({ id: "活動編號格式錯誤。" });

    const body = await readJson(request);
    if (!body) return jsonValidation({}, "資料格式錯誤。");

    const linkId = typeof body.id === "string" ? body.id.trim() : "";
    if (!linkId) return jsonValidation({}, "缺少 id。");
    if (!isUuid(linkId)) return jsonValidation({ id: "編號格式錯誤。" });

    // 先確認存在且屬於路徑上的活動（不屬於 → 404，不揭露別的活動的連結）
    const { data: row, error: readErr } = await supabase
      .from("event_album_links")
      .select("id, event_id")
      .eq("id", linkId)
      .maybeSingle();

    if (readErr) {
      if (isSchemaMissing(readErr)) return schemaOutdated();
      return jsonInternal("DELETE /api/admin/events/[id]/album-links read", readErr);
    }
    if (!row || (row as { event_id: string }).event_id !== eventId) {
      return jsonNotFound("找不到這筆相簿連結。");
    }

    const { error: deleteErr } = await supabase
      .from("event_album_links")
      .delete()
      .eq("id", linkId)
      .eq("event_id", eventId);

    if (deleteErr) {
      if (isSchemaMissing(deleteErr)) return schemaOutdated();
      return jsonInternal("DELETE /api/admin/events/[id]/album-links delete", deleteErr);
    }

    revalidateTag(RACES_TAG, { expire: 60 });
    revalidatePath("/events");

    return jsonOk({ message: "已刪除該筆相簿連結。" });
  } catch (err) {
    return jsonInternal("DELETE /api/admin/events/[id]/album-links", err);
  }
}

/* =============================================================
 * 降級判斷（migration 未跑）
 * ============================================================= */

function isSchemaMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  if (code === "42P01" || code === "PGRST205") return true;
  return /does not exist|schema cache/i.test(message) && /event_album_links/i.test(message);
}

function schemaOutdated() {
  return jsonErr(
    "相簿連結尚未開放，請先執行 supabase/migration-hyrox-results.sql。",
    "SCHEMA_OUTDATED",
    400
  );
}
