/**
 * /api/admin/hyrox/photos — HYROX 往期場次回顧相片的後台管理（管理員限定）
 *
 * 契約（回傳外殼一律是 src/lib/api.ts 的 { ok:true, ... } / { ok:false, error, code, fields? }）：
 *   GET  ?event_id=<uuid>
 *        → 200 { ok:true, photos:[{ id, event_id, path, url, caption, sort_order }] }
 *   POST { action:'add', event_id, path, caption? }
 *        → 201 { ok:true, photo:{...}, message }
 *   POST { action:'remove', id }
 *        → 200 { ok:true, removed:<id>, storage_deleted:boolean, message }
 *   POST { action:'update', id, caption?, sort_order? }
 *        → 200 { ok:true, photo:{...}, message }
 *
 * 資料表：supabase/migration-hyrox-photos.sql 的 public.event_photos。
 * path 是 site-assets bucket 內的相對路徑（events/ 前綴），url 由
 * publicAssetUrl()（src/lib/assets.ts:22）組成，前端不要自己拼。
 *
 * 【四個必查安全項】
 *   · 越權：整支先過 authorizeAdmin()（未設定 400 / 未登入 401 / 非管理員 403），
 *           RLS 另有 is_admin() 閘門做第二道。
 *   · IDOR：event_id / id 都是 uuid 格式檢查後才碰 DB；而且每個 action 都會
 *           回查所屬場次並確認 series='hyrox'，不能藉這支端點把相片掛到別的
 *           活動、也不能刪別的分類的相片。
 *   · 參數：path 必須符合 ^events/...\.(jpg|jpeg|png|webp)$、長度 ≤300、不含 `..`
 *           或反斜線；caption ≤300 字；sort_order 限 -9999–9999 整數。
 *   · 分頁：本端點沒有分頁參數（單場相片量以幾十張為量級），GET 硬上限
 *           PHOTO_LIMIT=500，超過即截斷——不會全量返回，也不會因 size 爆掉。
 *
 * 【線上尚未執行 migration 時】
 * event_photos 不存在時 PostgREST 會回 42P01 / PGRST205，這裡統一轉成可讀的
 * 400（SCHEMA_OUTDATED）並提示要跑哪個檔案，不讓管理頁看到裸 500。
 *
 * 【寫入後的副作用】
 *   · revalidatePath('/hyrox')、revalidatePath('/hyrox/[id]','page')、'/admin/hyrox'
 *   · revalidateTag(HYROX_EVENTS_TAG / HYROX_PHOTOS_TAG)：往期列表的 photo_count
 *     與詳情頁相片同時失效
 *   · writeAuditLog(supabase, actorId, 'hyrox', 'photos-add'|'photos-remove'|'photos-update', 摘要)
 *
 * H6：全支包 try/catch，任何情況都回 JSON；未實作的方法回 405 JSON。
 * Owner：白客（backend-engineer）
 */

import { revalidatePath, revalidateTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { publicAssetUrl } from "@/lib/assets";
import { HYROX_EVENTS_TAG, HYROX_PHOTOS_TAG } from "@/lib/queries";
import {
  isUuid,
  jsonBadJson,
  jsonDbError,
  jsonErr,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";
import { HYROX_SERIES } from "@/app/api/hyrox/_shared/contract";
import type { EventPhoto, EventPhotoWithUrl } from "@/lib/types";

/** GET 要抓的欄位（與契約一致；event_id 也回，方便前端對帳） */
const PHOTO_COLUMNS = "id,event_id,path,caption,sort_order";

/**
 * 相片路徑：必須是 site-assets 的 events/ 前綴圖片。
 * 與 migration-hyrox-photos.sql 的 event_photos_path_fmt 護欄對齊，
 * 也與 events.cover_path 的 COVER_RE（api/admin/hyrox/events/route.ts:50）同口徑。
 */
const PHOTO_PATH_RE = /^events\/[A-Za-z0-9][A-Za-z0-9/_.-]*\.(jpg|jpeg|png|webp)$/i;

/** 路徑長度上限（與 DB check 一致） */
const PATH_MAX = 300;
/** 說明長度上限（與 DB check 一致） */
const CAPTION_MAX = 300;
/** 單場相片回傳上限（防止任何情況下一次拉全表） */
const PHOTO_LIMIT = 500;
/** 新增時的排序間隔，留出中間插入的空間 */
const SORT_STEP = 10;
/** sort_order 允許範圍（與 DB check 一致） */
const SORT_MIN = -9999;
const SORT_MAX = 9999;

const NOT_FOUND_MSG = "找不到這筆 HYROX 場次。";
const PHOTO_NOT_FOUND_MSG = "找不到這張相片。";

/** 補上公開網址；結構穩定（caption 為 null 也保留 key） */
function withUrl(row: EventPhoto): EventPhotoWithUrl {
  return {
    id: row.id,
    event_id: row.event_id,
    path: row.path,
    url: publicAssetUrl(row.path),
    caption: row.caption ?? null,
    sort_order: Number(row.sort_order ?? 0),
  };
}

/**
 * 資料表還沒建（migration 未執行）的錯誤。
 * 42P01 = undefined_table；PGRST205 = PostgREST 在 schema cache 找不到該表。
 * 另外 PostgREST 的 message 也可能直接寫 "Could not find the table ... in the schema cache"。
 */
function isSchemaMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  if (code === "42P01" || code === "PGRST205") return true;
  return /does not exist|schema cache/i.test(message) && /event_photos/i.test(message);
}

/** DB 讀寫失敗的統一出口：先判斷「表還沒建」，其餘交給 api.ts 的對映 */
function dbFail(where: string, error: unknown) {
  if (isSchemaMissing(error)) {
    console.error(`[api] ${where} 資料表不存在：`, error);
    return jsonErr(
      "相片資料表尚未建立，請先執行 supabase/migration-hyrox-photos.sql。",
      "SCHEMA_OUTDATED",
      400
    );
  }
  return jsonInternal(where, error);
}

/** 外鍵違反（event_id 指向不存在的場次）→ 404，不讓使用者看到 23503 */
function isForeignKeyViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return String((error as { code?: unknown }).code ?? "") === "23503";
}

type EventGuard = "ok" | "notfound" | "error";

/**
 * IDOR 把關：確認這個 event_id 真的是一筆 HYROX 場次。
 * 不存在、「不是 hyrox 系列」一律回 notfound（不揭露該 id 屬於別的活動）。
 */
async function guardHyroxEvent(
  supabase: SupabaseClient,
  eventId: string
): Promise<EventGuard> {
  const { data, error } = await supabase
    .from("events")
    .select("id,series")
    .eq("id", eventId)
    .maybeSingle();

  if (error) return "error";
  if (!data) return "notfound";
  return (data as { series: string | null }).series === HYROX_SERIES ? "ok" : "notfound";
}

/**
 * caption 解析（與 api/admin/hyrox/events/route.ts:67 的 parseText 同口徑）：
 *   · 沒提供 → provided=false（update 時不寫入）
 *   · null / 空白 / 純空白 → 清空成 null
 *   · 超長或非字串 → 寫入 fields，呼叫端回 400
 */
function parseCaption(
  body: Record<string, unknown>,
  fields: Record<string, string>
): { provided: boolean; value: string | null } {
  if (!Object.prototype.hasOwnProperty.call(body, "caption")) {
    return { provided: false, value: null };
  }
  const raw = body.caption;
  if (raw === null || raw === undefined) return { provided: true, value: null };
  if (typeof raw !== "string") {
    fields.caption = "相片說明格式錯誤。";
    return { provided: true, value: null };
  }
  const trimmed = raw.trim();
  if (trimmed === "") return { provided: true, value: null };
  // 以 code point 計長，中文／emoji 不會被算成 2 個字
  if (Array.from(trimmed).length > CAPTION_MAX) {
    fields.caption = `相片說明請填 ${CAPTION_MAX} 字以內。`;
    return { provided: true, value: null };
  }
  return { provided: true, value: trimmed };
}

/** path 檢查；合法回 null，不合法回給使用者看的句子 */
function pathError(raw: unknown): string | null {
  if (typeof raw !== "string") return "請提供相片路徑（請先上傳圖片）。";
  const path = raw.trim();
  if (!path) return "請提供相片路徑（請先上傳圖片）。";
  if (path.length > PATH_MAX) return "相片路徑過長，請重新上傳。";
  if (path.includes("..") || path.includes("\\")) return "相片路徑格式錯誤，請重新上傳。";
  if (!path.startsWith("events/")) {
    return "相片路徑格式錯誤，必須是 events/ 底下的圖片。";
  }
  if (!PHOTO_PATH_RE.test(path)) {
    return "相片路徑格式錯誤，只接受 jpg／png／webp 圖片。";
  }
  return null;
}

/** 寫入後讓前台／後台快取失效 */
function revalidateHyroxPhotos() {
  revalidatePath("/hyrox");
  // 動態路由要用 "page" 型別，否則 Next 只當成一般路徑字串
  revalidatePath("/hyrox/[id]", "page");
  revalidatePath("/admin/hyrox");
  revalidateTag(HYROX_EVENTS_TAG, { expire: 60 });
  revalidateTag(HYROX_PHOTOS_TAG, { expire: 60 });
}

/* =============================================================
 * GET — 某一場次的相片列表
 * ============================================================= */
export async function GET(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    // 分頁邊界：本端點只有單一 event_id 的完整清單，用固定上限保護資料庫
    const eventId = new URL(request.url).searchParams.get("event_id")?.trim() ?? "";
    if (!eventId) {
      return jsonValidation({ event_id: "缺少場次編號（event_id）。" }, "請檢查場次編號。");
    }
    if (!isUuid(eventId)) {
      return jsonValidation({ event_id: "場次編號格式錯誤。" }, "請檢查場次編號。");
    }

    const guard = await guardHyroxEvent(supabase, eventId);
    if (guard === "error") {
      return jsonInternal("GET /api/admin/hyrox/photos guard", "讀取場次失敗");
    }
    if (guard === "notfound") return jsonNotFound(NOT_FOUND_MSG);

    const { data, error } = await supabase
      .from("event_photos")
      .select(PHOTO_COLUMNS)
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(PHOTO_LIMIT);

    if (error) return dbFail("GET /api/admin/hyrox/photos", error);

    const photos = ((data as EventPhoto[]) ?? []).map(withUrl);
    return jsonOk({ photos, truncated: photos.length >= PHOTO_LIMIT });
  } catch (err) {
    return jsonDbError("GET /api/admin/hyrox/photos", err);
  }
}

/* =============================================================
 * POST — add / remove / update
 * ============================================================= */
export async function POST(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const action = body.action;
    if (action !== "add" && action !== "remove" && action !== "update") {
      return jsonValidation(
        { action: "action 只接受 add、remove 或 update。" },
        "請檢查請求內容。"
      );
    }

    /* ---------------- add ---------------- */
    if (action === "add") {
      const rawEventId = body.event_id;
      if (typeof rawEventId !== "string" || rawEventId.trim() === "") {
        return jsonValidation({ event_id: "缺少場次編號（event_id）。" }, "請檢查場次編號。");
      }
      const eventId = rawEventId.trim();
      if (!isUuid(eventId)) {
        return jsonValidation({ event_id: "場次編號格式錯誤。" }, "請檢查場次編號。");
      }

      const pErr = pathError(body.path);
      if (pErr) return jsonValidation({ path: pErr }, "請檢查相片路徑。");
      const path = String(body.path ?? "").trim();

      const fields: Record<string, string> = {};
      const caption = parseCaption(body, fields);
      if (Object.keys(fields).length > 0) return jsonValidation(fields);

      const guard = await guardHyroxEvent(supabase, eventId);
      if (guard === "error") {
        return jsonInternal("POST /api/admin/hyrox/photos guard", "讀取場次失敗");
      }
      if (guard === "notfound") return jsonNotFound(NOT_FOUND_MSG);

      // 新相片排到最後：取目前最大值 +10（沒有相片時從 10 開始，留 0 給「置頂」）
      const { data: maxRow, error: maxErr } = await supabase
        .from("event_photos")
        .select("sort_order")
        .eq("event_id", eventId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (maxErr) return dbFail("POST /api/admin/hyrox/photos max(sort_order)", maxErr);

      const currentMax = Number((maxRow as { sort_order?: number } | null)?.sort_order ?? 0);
      const nextSort = Math.min(currentMax + SORT_STEP, SORT_MAX);

      const { data: inserted, error: insErr } = await supabase
        .from("event_photos")
        .insert({
          event_id: eventId,
          path,
          caption: caption.provided ? caption.value : null,
          sort_order: nextSort,
        })
        .select(PHOTO_COLUMNS)
        .single();

      if (insErr) {
        if (isForeignKeyViolation(insErr)) return jsonNotFound(NOT_FOUND_MSG);
        return dbFail("POST /api/admin/hyrox/photos insert", insErr);
      }

      revalidateHyroxPhotos();
      await writeAuditLog(
        supabase,
        actorId,
        "hyrox",
        "photos-add",
        `新增 HYROX 場次相片（${path}）`
      );

      const photo = withUrl(inserted as unknown as EventPhoto);
      return jsonOk({ photo, message: "已新增相片。" }, 201);
    }

    /* ---------------- remove ---------------- */
    if (action === "remove") {
      const rawId = body.id;
      if (typeof rawId !== "string" || rawId.trim() === "") {
        return jsonValidation({ id: "缺少相片編號（id）。" }, "請檢查相片編號。");
      }
      const id = rawId.trim();
      if (!isUuid(id)) {
        return jsonValidation({ id: "相片編號格式錯誤。" }, "請檢查相片編號。");
      }

      // 先取回 path（刪了就查不到），順便做歸屬檢查
      const { data: row, error: readErr } = await supabase
        .from("event_photos")
        .select("id,event_id,path")
        .eq("id", id)
        .maybeSingle();

      if (readErr) return dbFail("POST /api/admin/hyrox/photos read", readErr);
      if (!row) return jsonNotFound(PHOTO_NOT_FOUND_MSG);

      const target = row as { id: string; event_id: string; path: string };
      const guard = await guardHyroxEvent(supabase, target.event_id);
      if (guard === "error") {
        return jsonInternal("POST /api/admin/hyrox/photos guard", "讀取場次失敗");
      }
      if (guard === "notfound") return jsonNotFound(NOT_FOUND_MSG);

      const { data: deleted, error: delErr } = await supabase
        .from("event_photos")
        .delete()
        .eq("id", id)
        .select("id");

      if (delErr) return dbFail("POST /api/admin/hyrox/photos delete", delErr);
      if (!deleted || (deleted as { id: string }[]).length === 0) {
        return jsonNotFound(PHOTO_NOT_FOUND_MSG);
      }

      // Storage 物件：best-effort，失敗只記 log、不擋主流程
      // （DB 列已刪，留孤兒物件比讓管理員刪不掉好處理；storage 政策見 schema-r6.sql:151）
      let storageDeleted = false;
      try {
        const { error: storageErr } = await supabase.storage
          .from("site-assets")
          .remove([target.path]);
        if (storageErr) {
          console.warn(
            "[admin/hyrox/photos] Storage 刪除失敗（不擋主流程）：",
            storageErr.message
          );
        } else {
          storageDeleted = true;
        }
      } catch (err) {
        console.warn("[admin/hyrox/photos] Storage 刪除例外（不擋主流程）：", err);
      }

      revalidateHyroxPhotos();
      await writeAuditLog(
        supabase,
        actorId,
        "hyrox",
        "photos-remove",
        `刪除 HYROX 場次相片（${target.path}${storageDeleted ? "" : "，Storage 物件待清理"}）`
      );

      return jsonOk({
        removed: id,
        storage_deleted: storageDeleted,
        message: storageDeleted
          ? "已刪除相片。"
          : "已刪除相片紀錄；圖片檔清理失敗，已記錄待處理。",
      });
    }

    /* ---------------- update ---------------- */
    const rawId = body.id;
    if (typeof rawId !== "string" || rawId.trim() === "") {
      return jsonValidation({ id: "缺少相片編號（id）。" }, "請檢查相片編號。");
    }
    const id = rawId.trim();
    if (!isUuid(id)) {
      return jsonValidation({ id: "相片編號格式錯誤。" }, "請檢查相片編號。");
    }

    const fields: Record<string, string> = {};
    const patch: Record<string, unknown> = {};

    const caption = parseCaption(body, fields);
    if (caption.provided) patch.caption = caption.value;

    if (Object.prototype.hasOwnProperty.call(body, "sort_order")) {
      const raw = body.sort_order;
      if (raw === null || raw === undefined || String(raw).trim() === "") {
        fields.sort_order = "排序請填整數（或留空表示不改）。";
      } else {
        const n = typeof raw === "number" ? raw : Number(String(raw).trim());
        if (!Number.isInteger(n) || n < SORT_MIN || n > SORT_MAX) {
          fields.sort_order = `排序請填 ${SORT_MIN}–${SORT_MAX} 的整數。`;
        } else {
          patch.sort_order = n;
        }
      }
    }

    if (Object.keys(fields).length > 0) return jsonValidation(fields);
    if (Object.keys(patch).length === 0) {
      return jsonValidation({}, "沒有需要更新的欄位。");
    }

    // 歸屬檢查：先確認這張相片存在、且屬於 HYROX 場次
    const { data: row, error: readErr } = await supabase
      .from("event_photos")
      .select("id,event_id")
      .eq("id", id)
      .maybeSingle();

    if (readErr) return dbFail("POST /api/admin/hyrox/photos read", readErr);
    if (!row) return jsonNotFound(PHOTO_NOT_FOUND_MSG);

    const guard = await guardHyroxEvent(
      supabase,
      (row as { event_id: string }).event_id
    );
    if (guard === "error") {
      return jsonInternal("POST /api/admin/hyrox/photos guard", "讀取場次失敗");
    }
    if (guard === "notfound") return jsonNotFound(NOT_FOUND_MSG);

    const { data: updated, error: updErr } = await supabase
      .from("event_photos")
      .update(patch)
      .eq("id", id)
      .select(PHOTO_COLUMNS)
      .single();

    if (updErr) return dbFail("POST /api/admin/hyrox/photos update", updErr);

    revalidateHyroxPhotos();
    await writeAuditLog(
      supabase,
      actorId,
      "hyrox",
      "photos-update",
      `更新 HYROX 場次相片（${id}）`
    );

    return jsonOk({
      photo: withUrl(updated as unknown as EventPhoto),
      message: "已更新相片。",
    });
  } catch (err) {
    return jsonDbError("POST /api/admin/hyrox/photos", err);
  }
}

/** H6：未實作的方法也要回 JSON */
export async function PUT() {
  return jsonMethodNotAllowed();
}
export const PATCH = PUT;
export const DELETE = PUT;
