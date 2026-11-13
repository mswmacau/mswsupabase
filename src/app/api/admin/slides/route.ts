/**
 * /api/admin/slides — 首頁圖片輪播的後台管理（管理員限定）
 *
 * 契約（回傳外殼一律是 src/lib/api.ts 的 { ok:true, ... } / { ok:false, error, code, fields? }）：
 *   GET  → 200 { ok:true, slides:[HomeSlide] }            （含停用，sort_order 升冪）
 *   POST { action:'create', path, alt, link_url?, sort_order? }
 *        → 201 { ok:true, slide, message }
 *   POST { action:'update', id, alt?, link_url?, sort_order?, is_active?, starts_at?, ends_at? }
 *        → 200 { ok:true, slide, message }                 （只寫 body 有提供的欄位）
 *   POST { action:'remove', id }
 *        → 200 { ok:true, removed:<id>, storage_deleted:boolean, message }
 *   POST { action:'reorder', ids:[uuid] }
 *        → 200 { ok:true, message }                        （依陣列順序重寫成 10/20/30…）
 *
 * 資料表：supabase/migration-home-slides.sql 的 public.home_slides。
 * path 是 site-assets bucket 內的相對路徑（home/ 前綴），前端不要自己拼網址，
 * 一律用 publicAssetUrl()（src/lib/assets.ts:22）。
 *
 * 【四個必查安全項】
 *   · 越權：整支先過 authorizeAdmin()（未設定 400 / 未登入 401 / 非管理員 403），
 *           RLS 的 home_slides_admin_all 另有 is_admin() 閘門做第二道。
 *   · 參數：path 必須是 home/ 前綴的 jpg/png/webp、≤300、不含 `..` 或反斜線；
 *           alt 1–120 字；link_url 只准站內（單一 / 開頭，明確拒絕 // 開頭）；
 *           sort_order 限 -9999–9999 整數；starts_at 必須早於 ends_at。
 *   · 數量：create 前先 count，已達 30 筆回 409；DB 另有 trigger 做最後防線。
 *   · 分頁：本端點只回 30 筆（就是全表上限），不會全量返回也不會爆 size。
 *
 * 【線上尚未執行 migration 時】
 * home_slides 不存在時 PostgREST 會回 42P01 / PGRST205，這裡統一轉成可讀的
 * 400（SCHEMA_OUTDATED）並點名要跑哪個檔案，不讓管理頁看到裸 500。
 *
 * 【寫入後的副作用】
 *   revalidatePath('/') + revalidateTag(HOME_SLIDES_TAG, { expire: 60 })
 *   + writeAuditLog(supabase, actorId, 'home', 'slides-…', 中文摘要)
 *
 * H6：全支包 try/catch，任何情況都回 JSON；未實作的方法回 405 JSON。
 */

import { revalidatePath, revalidateTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { HOME_SLIDES_MAX, HOME_SLIDES_TAG, type HomeSlide } from "@/lib/home-slides";
import {
  isUuid,
  jsonBadJson,
  jsonConflict,
  jsonDbError,
  jsonErr,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";

const SITE_ASSETS = "site-assets";
const SLIDE_COLUMNS = "id,path,alt,link_url,sort_order,is_active,starts_at,ends_at";

/**
 * 圖片路徑：必須是 site-assets 的 home/ 前綴圖片。
 * 與 migration-home-slides.sql 的 home_slides_path_fmt 護欄同口徑。
 */
const SLIDE_PATH_RE = /^home\/[A-Za-z0-9][A-Za-z0-9/_.-]*\.(jpg|jpeg|png|webp)$/i;

const PATH_MAX = 300;
const ALT_MAX = 120;
const LINK_MAX = 300;
const SORT_MIN = -9999;
const SORT_MAX = 9999;
/** 重排間隔，留出中間插入的空間 */
const SORT_STEP = 10;

const SLIDE_NOT_FOUND_MSG = "找不到這張輪播圖。";

/* =============================================================
 * 共用小工具
 * ============================================================= */

/** DB 列 → HomeSlide（與 src/lib/home-slides.ts 的 toSlide 同一口徑） */
function toSlide(row: Record<string, unknown>): HomeSlide {
  return {
    id: String(row.id ?? ""),
    path: String(row.path ?? ""),
    alt: String(row.alt ?? ""),
    link_url: typeof row.link_url === "string" && row.link_url ? row.link_url : null,
    sort_order: Number(row.sort_order ?? 0),
    is_active: row.is_active !== false,
    starts_at: typeof row.starts_at === "string" ? row.starts_at : null,
    ends_at: typeof row.ends_at === "string" ? row.ends_at : null,
  };
}

/**
 * 資料表還沒建（migration 未執行）的錯誤。
 * 42P01 = undefined_table；PGRST205 = PostgREST 在 schema cache 找不到該表。
 */
function isSchemaMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  if (code === "42P01" || code === "PGRST205") return true;
  return /does not exist|schema cache/i.test(message) && /home_slides/i.test(message);
}

/** DB 讀寫失敗的統一出口：先判斷「表還沒建」，其餘交給 api.ts 的對映 */
function dbFail(where: string, error: unknown) {
  if (isSchemaMissing(error)) {
    console.error(`[api] ${where} 資料表不存在：`, error);
    return jsonErr(
      "輪播資料表尚未建立，請先執行 supabase/migration-home-slides.sql。",
      "SCHEMA_OUTDATED",
      400
    );
  }
  return jsonInternal(where, error);
}

/** 以 code point 計長，中文／emoji 不會被算成 2 個字 */
function charLen(s: string): number {
  return Array.from(s).length;
}

/** path 檢查；合法回 null，不合法回給使用者看的句子 */
function pathError(raw: unknown): string | null {
  if (typeof raw !== "string") return "請提供圖片路徑（請先上傳圖片）。";
  const path = raw.trim();
  if (!path) return "請提供圖片路徑（請先上傳圖片）。";
  if (path.length > PATH_MAX) return "圖片路徑過長，請重新上傳。";
  if (path.includes("..") || path.includes("\\")) {
    return "圖片路徑格式錯誤，請重新上傳。";
  }
  if (!path.startsWith("home/")) {
    return "圖片路徑格式錯誤，必須是 home/ 底下的圖片。";
  }
  if (!SLIDE_PATH_RE.test(path)) {
    return "圖片路徑格式錯誤，只接受 jpg／png／webp 圖片。";
  }
  return null;
}

/**
 * alt 解析（必填）：
 *   · 非字串／空白 → 錯誤
 *   · 超過 120 字 → 錯誤
 */
function parseAltStrict(
  body: Record<string, unknown>,
  fields: Record<string, string>
): string | null {
  const raw = body.alt;
  if (typeof raw !== "string" || raw.trim() === "") {
    fields.alt = "請填寫圖片的替代文字（例如：會員在館內訓練）。";
    return null;
  }
  const trimmed = raw.trim();
  if (charLen(trimmed) > ALT_MAX) {
    fields.alt = `替代文字請填 ${ALT_MAX} 字以內。`;
    return null;
  }
  return trimmed;
}

/**
 * alt 選填版（update 用）：
 *   · 沒提供 → provided=false
 *   · 提供但不合法 → 寫入 fields
 */
function parseAltOptional(
  body: Record<string, unknown>,
  fields: Record<string, string>
): { provided: boolean; value: string | null } {
  if (!Object.prototype.hasOwnProperty.call(body, "alt")) {
    return { provided: false, value: null };
  }
  const value = parseAltStrict(body, fields);
  return { provided: true, value };
}

/**
 * link_url 解析（選填，只准站內）：
 *   · 沒提供 → provided=false（update 時不寫入）
 *   · null / 空白 → 清空成 null
 *   · 必須以「單一 /」開頭：`//evil.com` 是 protocol-relative 外部連結，
 *     瀏覽器會當成 https://evil.com 跳走，必須明確擋掉
 */
function parseLinkUrl(
  body: Record<string, unknown>,
  fields: Record<string, string>
): { provided: boolean; value: string | null } {
  if (!Object.prototype.hasOwnProperty.call(body, "link_url")) {
    return { provided: false, value: null };
  }
  const raw = body.link_url;
  if (raw === null || raw === undefined) return { provided: true, value: null };
  if (typeof raw !== "string") {
    fields.link_url = "連結格式錯誤。";
    return { provided: true, value: null };
  }
  const trimmed = raw.trim();
  if (trimmed === "") return { provided: true, value: null };
  if (trimmed.length > LINK_MAX) {
    fields.link_url = `連結請填 ${LINK_MAX} 字以內。`;
    return { provided: true, value: null };
  }
  if (!trimmed.startsWith("/")) {
    fields.link_url = "連結只接受站內路徑，請以 / 開頭（例如 /events）。";
    return { provided: true, value: null };
  }
  if (trimmed.startsWith("//")) {
    fields.link_url = "連結不可指向外部網站，請填站內路徑（例如 /events）。";
    return { provided: true, value: null };
  }
  if (/\s/.test(trimmed)) {
    fields.link_url = "連結不可包含空白。";
    return { provided: true, value: null };
  }
  return { provided: true, value: trimmed };
}

/** sort_order 解析（選填，整數 -9999–9999） */
function parseSortOrder(
  body: Record<string, unknown>,
  fields: Record<string, string>
): { provided: boolean; value: number | null } {
  if (!Object.prototype.hasOwnProperty.call(body, "sort_order")) {
    return { provided: false, value: null };
  }
  const raw = body.sort_order;
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    fields.sort_order = `排序請填 ${SORT_MIN}–${SORT_MAX} 的整數。`;
    return { provided: true, value: null };
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < SORT_MIN || n > SORT_MAX) {
    fields.sort_order = `排序請填 ${SORT_MIN}–${SORT_MAX} 的整數。`;
    return { provided: true, value: null };
  }
  return { provided: true, value: n };
}

/** boolean 解析（update 的 is_active） */
function parseBoolean(
  body: Record<string, unknown>,
  key: string,
  fields: Record<string, string>
): { provided: boolean; value: boolean | null } {
  if (!Object.prototype.hasOwnProperty.call(body, key)) {
    return { provided: false, value: null };
  }
  const raw = body[key];
  if (typeof raw !== "boolean") {
    fields[key] = "請提供 true 或 false。";
    return { provided: true, value: null };
  }
  return { provided: true, value: raw };
}

/**
 * timestamptz 解析（starts_at / ends_at，選填）：
 *   · 沒提供 → provided=false
 *   · null / 空白 → 清空成 null（＝取消排程）
 *   · 其餘必須是 Date 可解析的字串，統一轉成 ISO
 */
function parseTimestamp(
  body: Record<string, unknown>,
  key: string,
  fields: Record<string, string>
): { provided: boolean; value: string | null } {
  if (!Object.prototype.hasOwnProperty.call(body, key)) {
    return { provided: false, value: null };
  }
  const raw = body[key];
  if (raw === null || raw === undefined) return { provided: true, value: null };
  if (typeof raw !== "string") {
    fields[key] = "時間格式錯誤。";
    return { provided: true, value: null };
  }
  const trimmed = raw.trim();
  if (trimmed === "") return { provided: true, value: null };
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) {
    fields[key] = "時間格式錯誤，請用 2026-01-31T00:00:00Z 這種格式。";
    return { provided: true, value: null };
  }
  return { provided: true, value: d.toISOString() };
}

/** 排程一致性：有頭有尾時上架必須早於下架（與 DB check 同口徑） */
function checkScheduleOrder(
  startsAt: string | null,
  endsAt: string | null,
  fields: Record<string, string>
): void {
  if (!startsAt || !endsAt) return;
  if (new Date(startsAt).getTime() >= new Date(endsAt).getTime()) {
    fields.ends_at = "下架時間必須晚於上架時間。";
  }
}

/** 寫入後讓前台快取失效 */
function revalidateSlides() {
  revalidatePath("/");
  revalidateTag(HOME_SLIDES_TAG, { expire: 60 });
}

/**
 * 目前筆數。
 * 注意：PostgREST 對「不存在的表 + head:true + count」有時不回 error 而是回 count=null，
 * 所以這裡把 error 原樣交回呼叫端，不要用 `count ?? 0` 假裝成功——
 * 表還沒建時真正會擋下來的是隨後的 insert（見 create 分支）。
 */
async function countSlides(
  supabase: SupabaseClient
): Promise<{ count: number; error: unknown }> {
  const { count, error } = await supabase
    .from("home_slides")
    .select("id", { count: "exact", head: true });
  return { count: count ?? 0, error };
}

/* =============================================================
 * GET — 全部輪播圖（含停用）
 * ============================================================= */
export async function GET() {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    const { data, error } = await supabase
      .from("home_slides")
      .select(SLIDE_COLUMNS)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(HOME_SLIDES_MAX);

    if (error) return dbFail("GET /api/admin/slides", error);

    const slides = ((data as Record<string, unknown>[]) ?? []).map(toSlide);
    return jsonOk({ slides });
  } catch (err) {
    return jsonDbError("GET /api/admin/slides", err);
  }
}

/* =============================================================
 * POST — create / update / remove / reorder
 * ============================================================= */
export async function POST(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const action = body.action;
    if (
      action !== "create" &&
      action !== "update" &&
      action !== "remove" &&
      action !== "reorder"
    ) {
      return jsonValidation(
        { action: "action 只接受 create、update、remove 或 reorder。" },
        "請檢查請求內容。"
      );
    }

    /* ---------------- create ---------------- */
    if (action === "create") {
      const fields: Record<string, string> = {};

      const pErr = pathError(body.path);
      if (pErr) fields.path = pErr;
      const path = typeof body.path === "string" ? body.path.trim() : "";

      const alt = parseAltStrict(body, fields);
      const linkUrl = parseLinkUrl(body, fields);
      const sortOrder = parseSortOrder(body, fields);

      if (Object.keys(fields).length > 0) return jsonValidation(fields);

      // 數量前置檢查：DB trigger 是最後防線，這裡給可讀的 409
      const { count: current, error: countErr } = await countSlides(supabase);
      if (countErr) return dbFail("POST /api/admin/slides count", countErr);
      if (current >= HOME_SLIDES_MAX) {
        return jsonConflict(
          `首頁輪播最多 ${HOME_SLIDES_MAX} 張，請先刪除不需要的圖片。`
        );
      }

      // 沒指定排序就排到最後：取目前最大值 +10（沒有資料時從 10 開始）
      let nextSort: number;
      if (sortOrder.provided && sortOrder.value !== null) {
        nextSort = sortOrder.value;
      } else {
        const { data: maxRow, error: maxErr } = await supabase
          .from("home_slides")
          .select("sort_order")
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (maxErr) return dbFail("POST /api/admin/slides max(sort_order)", maxErr);
        const currentMax = Number(
          (maxRow as { sort_order?: number } | null)?.sort_order ?? 0
        );
        nextSort = Math.min(currentMax + SORT_STEP, SORT_MAX);
      }

      const { data: inserted, error: insErr } = await supabase
        .from("home_slides")
        .insert({
          path,
          alt: alt ?? "",
          link_url: linkUrl.provided ? linkUrl.value : null,
          sort_order: nextSort,
        })
        .select(SLIDE_COLUMNS)
        .single();

      if (insErr) return dbFail("POST /api/admin/slides insert", insErr);

      revalidateSlides();
      await writeAuditLog(
        supabase,
        actorId,
        "home",
        "slides-create",
        `新增首頁輪播圖（${path}）`
      );

      return jsonOk(
        {
          slide: toSlide(inserted as unknown as Record<string, unknown>),
          message: "已新增輪播圖。",
        },
        201
      );
    }

    /* ---------------- reorder ---------------- */
    if (action === "reorder") {
      const rawIds = body.ids;
      if (!Array.isArray(rawIds) || rawIds.length === 0) {
        return jsonValidation({ ids: "請提供要排序的輪播圖編號清單。" }, "請檢查排序內容。");
      }
      if (rawIds.length > HOME_SLIDES_MAX) {
        return jsonValidation({
          ids: `一次最多排序 ${HOME_SLIDES_MAX} 張。`,
        });
      }
      const ids: string[] = [];
      for (const raw of rawIds) {
        if (typeof raw !== "string" || !isUuid(raw.trim())) {
          return jsonValidation({ ids: "輪播圖編號格式錯誤。" }, "請檢查排序內容。");
        }
        ids.push(raw.trim());
      }
      if (new Set(ids).size !== ids.length) {
        return jsonValidation({ ids: "編號清單有重複。" }, "請檢查排序內容。");
      }

      // 先確認這些 id 全部存在（避免默默只改到幾筆）
      const { data: existing, error: readErr } = await supabase
        .from("home_slides")
        .select("id")
        .in("id", ids);

      if (readErr) return dbFail("POST /api/admin/slides reorder read", readErr);
      const found = new Set(
        ((existing as { id: string }[]) ?? []).map((r) => r.id)
      );
      if (found.size !== ids.length) return jsonNotFound(SLIDE_NOT_FOUND_MSG);

      // 依陣列順序重寫 sort_order（10/20/30…，保留中間插入空間）
      for (const [index, id] of ids.entries()) {
        const { error: updErr } = await supabase
          .from("home_slides")
          .update({ sort_order: (index + 1) * SORT_STEP })
          .eq("id", id);
        if (updErr) return dbFail("POST /api/admin/slides reorder update", updErr);
      }

      revalidateSlides();
      await writeAuditLog(
        supabase,
        actorId,
        "home",
        "slides-reorder",
        `調整首頁輪播順序（共 ${ids.length} 張）`
      );

      return jsonOk({ message: "已更新輪播順序。" });
    }

    /* ---------------- remove ---------------- */
    if (action === "remove") {
      const rawId = body.id;
      if (typeof rawId !== "string" || rawId.trim() === "") {
        return jsonValidation({ id: "缺少輪播圖編號（id）。" }, "請檢查輪播圖編號。");
      }
      const id = rawId.trim();
      if (!isUuid(id)) {
        return jsonValidation({ id: "輪播圖編號格式錯誤。" }, "請檢查輪播圖編號。");
      }

      // 先取回 path（刪了就查不到）
      const { data: row, error: readErr } = await supabase
        .from("home_slides")
        .select("id,path")
        .eq("id", id)
        .maybeSingle();

      if (readErr) return dbFail("POST /api/admin/slides remove read", readErr);
      if (!row) return jsonNotFound(SLIDE_NOT_FOUND_MSG);

      const targetPath = String((row as { path: string }).path ?? "");

      const { data: deleted, error: delErr } = await supabase
        .from("home_slides")
        .delete()
        .eq("id", id)
        .select("id");

      if (delErr) return dbFail("POST /api/admin/slides delete", delErr);
      if (!deleted || (deleted as { id: string }[]).length === 0) {
        return jsonNotFound(SLIDE_NOT_FOUND_MSG);
      }

      // Storage 物件：best-effort，失敗只記 log、不擋主流程
      // （DB 列已刪，留孤兒物件比讓管理員刪不掉好處理；storage 政策見 schema-r6.sql:151）
      let storageDeleted = false;
      if (targetPath) {
        try {
          const { error: storageErr } = await supabase.storage
            .from(SITE_ASSETS)
            .remove([targetPath]);
          if (storageErr) {
            console.warn(
              "[admin/slides] Storage 刪除失敗（不擋主流程）：",
              storageErr.message
            );
          } else {
            storageDeleted = true;
          }
        } catch (err) {
          console.warn("[admin/slides] Storage 刪除例外（不擋主流程）：", err);
        }
      }

      revalidateSlides();
      await writeAuditLog(
        supabase,
        actorId,
        "home",
        "slides-remove",
        `刪除首頁輪播圖（${targetPath}${storageDeleted ? "" : "，Storage 物件待清理"}）`
      );

      return jsonOk({
        removed: id,
        storage_deleted: storageDeleted,
        message: storageDeleted
          ? "已刪除輪播圖。"
          : "已刪除輪播圖紀錄；圖片檔清理失敗，已記錄待處理。",
      });
    }

    /* ---------------- update ---------------- */
    const rawId = body.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return jsonValidation({ id: "缺少輪播圖編號（id）。" }, "請檢查輪播圖編號。");
    }
    const id = rawId.trim();
    if (!isUuid(id)) {
      return jsonValidation({ id: "輪播圖編號格式錯誤。" }, "請檢查輪播圖編號。");
    }

    const fields: Record<string, string> = {};
    const patch: Record<string, unknown> = {};

    const alt = parseAltOptional(body, fields);
    if (alt.provided && alt.value !== null) patch.alt = alt.value;

    const linkUrl = parseLinkUrl(body, fields);
    if (linkUrl.provided) patch.link_url = linkUrl.value;

    const sortOrder = parseSortOrder(body, fields);
    if (sortOrder.provided && sortOrder.value !== null) {
      patch.sort_order = sortOrder.value;
    }

    const isActive = parseBoolean(body, "is_active", fields);
    if (isActive.provided && isActive.value !== null) {
      patch.is_active = isActive.value;
    }

    const startsAt = parseTimestamp(body, "starts_at", fields);
    if (startsAt.provided) patch.starts_at = startsAt.value;

    const endsAt = parseTimestamp(body, "ends_at", fields);
    if (endsAt.provided) patch.ends_at = endsAt.value;

    if (Object.keys(fields).length > 0) return jsonValidation(fields);
    if (Object.keys(patch).length === 0) {
      return jsonValidation({}, "沒有需要更新的欄位。");
    }

    // 排程一致性要跟「現有值」一起比對（可能只改其中一端）
    if (
      Object.prototype.hasOwnProperty.call(patch, "starts_at") ||
      Object.prototype.hasOwnProperty.call(patch, "ends_at")
    ) {
      const { data: current, error: readErr } = await supabase
        .from("home_slides")
        .select("id,starts_at,ends_at")
        .eq("id", id)
        .maybeSingle();

      if (readErr) return dbFail("POST /api/admin/slides update read", readErr);
      if (!current) return jsonNotFound(SLIDE_NOT_FOUND_MSG);

      const row = current as {
        starts_at: string | null;
        ends_at: string | null;
      };
      const nextStart = Object.prototype.hasOwnProperty.call(patch, "starts_at")
        ? (patch.starts_at as string | null)
        : row.starts_at;
      const nextEnd = Object.prototype.hasOwnProperty.call(patch, "ends_at")
        ? (patch.ends_at as string | null)
        : row.ends_at;

      const scheduleFields: Record<string, string> = {};
      checkScheduleOrder(nextStart, nextEnd, scheduleFields);
      if (Object.keys(scheduleFields).length > 0) {
        return jsonValidation(scheduleFields);
      }
    }

    const { data: updated, error: updErr } = await supabase
      .from("home_slides")
      .update(patch)
      .eq("id", id)
      .select(SLIDE_COLUMNS)
      .single();

    if (updErr) {
      // .single() 在 0 列時會回 PGRST116；這裡視為「找不到」
      if (String((updErr as { code?: unknown }).code ?? "") === "PGRST116") {
        return jsonNotFound(SLIDE_NOT_FOUND_MSG);
      }
      return dbFail("POST /api/admin/slides update", updErr);
    }

    revalidateSlides();
    await writeAuditLog(
      supabase,
      actorId,
      "home",
      "slides-update",
      `更新首頁輪播圖（${id}）`
    );

    return jsonOk({
      slide: toSlide(updated as unknown as Record<string, unknown>),
      message: "已更新輪播圖。",
    });
  } catch (err) {
    return jsonDbError("POST /api/admin/slides", err);
  }
}

/** H6：未實作的方法也要回 JSON */
export async function PUT() {
  return jsonMethodNotAllowed();
}
export const PATCH = PUT;
export const DELETE = PUT;
