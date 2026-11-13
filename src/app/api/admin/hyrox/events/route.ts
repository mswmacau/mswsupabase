/**
 * /api/admin/hyrox/events — HYROX 場次的後台列表與新增／更新（管理員限定）
 *
 * GET   → { ok:true, events:[{...場次, registrations_count, pending_count}] }
 * POST  → { action:'create' | 'update', ...欄位 } → 201 / 200
 * DELETE ?id=<uuid> → 200 { ok:true, removed, title, photos_removed, storage_deleted }
 *
 * 契約要點：
 *   · event_date 可為 null（日期待定）；fee_cents 0–1000000；
 *     status 只接受 draft | published | archived；create 時強制 series='hyrox'。
 *   · 全部經過 authorizeAdmin()：未設定 400 / 未登入 401 / 非管理員 403。
 *   · DELETE 的 id 走 query string（不是 body）；安全閘門依序為
 *     404 NOT_FOUND（不存在或非 HYROX）→ 409 PUBLISHED（請先下架）→
 *     409 HAS_REGISTRATIONS（已有 N 筆報名，改為下架保留）。
 *
 * 安全與資料紀律：
 *   · created_by 由伺服器帶入（actorId），body 內的值一律忽略。
 *   · update 只允許改 series='hyrox' 的場次（不能藉這支端點改一般活動，
 *     也不能改別人的活動分類）。
 *   · 長度上限與 DB check constraint 對齊（schema-r6.sql ＋ migration-paid-events-1.sql），
 *     先用可讀的 400 擋掉，不讓使用者看到 500。
 *   · 寫入成功後 revalidatePath + revalidateTag(HYROX_EVENTS_TAG)，前台快取立即失效。
 *   · DELETE 前先查出 event_photos 的 path 與 cover_path，DB 刪除成功後才
 *     best-effort 清 Storage 物件（失敗只記 log，不影響已完成的刪除）。
 *
 * H6：全支包 try/catch，任何情況都回 JSON。
 * Owner：白客（backend-engineer）
 */

import { revalidatePath, revalidateTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { HYROX_EVENTS_TAG } from "@/lib/queries";
import {
  isUuid,
  jsonBadJson,
  jsonConflict,
  jsonDbError,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";
import { HYROX_SERIES, hyroxErr } from "@/app/api/hyrox/_shared/contract";
import type { EventStatus, HyroxEvent, HyroxEventWithCounts } from "@/lib/types";

/** 後台列表要抓的欄位（與 GET 契約一致） */
const EVENT_COLUMNS =
  "id,title,subtitle,body,event_date,end_date,start_time,end_time,location," +
  "capacity,fee_cents,payment_qr_path,payment_phone,payment_note,status," +
  "sort_order,cover_path,series,created_by,created_at,updated_at";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** cover_path 的 DB check（schema-r6.sql events.cover_path） */
const COVER_RE = /^events\/[A-Za-z0-9][A-Za-z0-9/_.-]*\.(jpg|jpeg|png|webp)$/i;
/** payment_qr_path：Storage 內的相對路徑，只收圖片副檔名、不含 .. 或反斜線 */
const ASSET_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]*\.(jpg|jpeg|png|webp)$/i;

const EVENT_STATUSES: readonly EventStatus[] = ["draft", "published", "archived"];

const NOT_FOUND_MSG = "找不到這筆 HYROX 場次。";

/** 場次相片／封面所在的公開 bucket（與 src/lib/upload.ts 一致） */
const SITE_ASSETS = "site-assets";

/** 日期字串是否為真實存在的日期（擋掉 2026-02-31 這種） */
function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

/** 共用文字欄位：undefined = 沒提供（不寫入）；null/空白 = 清空 */
function parseText(
  body: Record<string, unknown>,
  key: string,
  maxLen: number,
  fields: Record<string, string>,
  message: string
): { provided: boolean; value: string | null } {
  if (!Object.prototype.hasOwnProperty.call(body, key)) {
    return { provided: false, value: null };
  }
  const raw = body[key];
  if (raw === null || raw === undefined) return { provided: true, value: null };
  if (typeof raw !== "string") {
    fields[key] = message;
    return { provided: true, value: null };
  }
  const trimmed = raw.trim();
  if (trimmed === "") return { provided: true, value: null };
  if (Array.from(trimmed).length > maxLen) {
    fields[key] = message;
    return { provided: true, value: null };
  }
  return { provided: true, value: trimmed };
}

/**
 * 逐欄解析；違規寫入 fields，合法結果放進回傳的 patch。
 * partial=true（update）時只處理 body 內有出現的欄位。
 */
function parseEventFields(
  body: Record<string, unknown>,
  fields: Record<string, string>,
  opts: { partial: boolean }
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const provided = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  /* ---- title ---- */
  if (provided("title") || !opts.partial) {
    const raw = body.title;
    const title = typeof raw === "string" ? raw.trim() : "";
    if (Array.from(title).length < 1 || Array.from(title).length > 120) {
      fields.title = "請填寫場次標題（1–120 字）。";
    } else {
      patch.title = title;
    }
  }

  /* ---- event_date（可為 null = 日期待定）---- */
  if (provided("event_date") || !opts.partial) {
    const raw = body.event_date;
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      patch.event_date = null;
    } else if (typeof raw === "string" && isRealDate(raw.trim())) {
      patch.event_date = raw.trim();
    } else {
      fields.event_date = "請選擇正確的活動日期，或留空表示日期待定。";
    }
  }

  /* ---- end_date ---- */
  if (provided("end_date")) {
    const raw = body.end_date;
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      patch.end_date = null;
    } else if (typeof raw === "string" && isRealDate(raw.trim())) {
      patch.end_date = raw.trim();
    } else {
      fields.end_date = "請選擇正確的活動日期。";
    }
  }

  /* ---- 時間（自由文字，例如 19:30）---- */
  for (const key of ["start_time", "end_time"] as const) {
    const r = parseText(body, key, 20, fields, "時間請填 20 字以內，例如 19:30。");
    if (r.provided) patch[key] = r.value;
  }

  /* ---- 其餘文字欄位 ---- */
  const subtitle = parseText(body, "subtitle", 200, fields, "副標請填 200 字以內。");
  if (subtitle.provided) patch.subtitle = subtitle.value;

  const bodyText = parseText(body, "body", 5000, fields, "場次內容請填 5000 字以內。");
  if (bodyText.provided) patch.body = bodyText.value;

  const location = parseText(body, "location", 120, fields, "地點請填 120 字以內。");
  if (location.provided) patch.location = location.value;

  const payPhone = parseText(body, "payment_phone", 30, fields, "收款電話請填 30 字以內。");
  if (payPhone.provided) patch.payment_phone = payPhone.value;

  const payNote = parseText(body, "payment_note", 300, fields, "付款說明請填 300 字以內。");
  if (payNote.provided) patch.payment_note = payNote.value;

  /* ---- capacity（null 或 1–99999）---- */
  if (provided("capacity")) {
    const raw = body.capacity;
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      patch.capacity = null;
    } else {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isInteger(n) || n < 1 || n > 99999) {
        fields.capacity = "名額請填 1–99999 的整數，或留空。";
      } else {
        patch.capacity = n;
      }
    }
  }

  /* ---- fee_cents（契約：0–1000000）---- */
  if (provided("fee_cents") || !opts.partial) {
    const raw = body.fee_cents;
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      patch.fee_cents = 0;
    } else {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isInteger(n) || n < 0 || n > 1000000) {
        fields.fee_cents = "報名費請填 0–1000000 的分（整數）。";
      } else {
        patch.fee_cents = n;
      }
    }
  }

  /* ---- payment_qr_path / cover_path ---- */
  if (provided("payment_qr_path")) {
    const raw = body.payment_qr_path;
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      patch.payment_qr_path = null;
    } else if (
      typeof raw === "string" &&
      raw.trim().length <= 500 &&
      !raw.includes("..") &&
      ASSET_PATH_RE.test(raw.trim())
    ) {
      patch.payment_qr_path = raw.trim();
    } else {
      fields.payment_qr_path = "收款 QR 路徑格式錯誤，請重新上傳。";
    }
  }

  if (provided("cover_path")) {
    const raw = body.cover_path;
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      patch.cover_path = null;
    } else if (typeof raw === "string" && COVER_RE.test(raw.trim())) {
      patch.cover_path = raw.trim();
    } else {
      fields.cover_path = "封面圖片格式錯誤，請重新上傳。";
    }
  }

  /* ---- status ---- */
  if (provided("status")) {
    const s = body.status;
    if (typeof s === "string" && (EVENT_STATUSES as string[]).includes(s)) {
      patch.status = s as EventStatus;
    } else {
      fields.status = "上下架狀態錯誤（只接受 draft / published / archived）。";
    }
  }

  /* ---- sort_order ---- */
  if (provided("sort_order")) {
    const n = Number(String(body.sort_order ?? "").trim());
    patch.sort_order = Number.isInteger(n) && n >= -9999 && n <= 9999 ? n : 0;
  }

  return patch;
}

/**
 * DB 錯誤 → 可讀的 400／500。
 * 23502（not null 違反）目前只會來自 event_date：線上 events.event_date 仍是
 * `date not null`，後台若真的存空日期，這裡回可讀的 400 而不是 500。
 */
function handleWriteError(where: string, error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";

  if (code === "23502") {
    if (message.includes("event_date")) {
      return jsonValidation(
        { event_date: "目前資料庫尚未允許「日期待定」，請先填寫活動日期。" },
        "請檢查場次資料。"
      );
    }
    return jsonValidation({}, "缺少必填欄位，請檢查後再試。");
  }
  if (code === "23514" || code === "22001" || code === "22P02") {
    return jsonValidation({}, "資料格式不正確，請檢查後再試。");
  }
  return jsonInternal(where, error);
}

/** 每個場次的報名／待審統計（一次查回所有相關列，再在記憶體彙總） */
async function countRegistrations(
  supabase: SupabaseClient,
  eventIds: string[]
): Promise<Map<string, { registrations_count: number; pending_count: number }>> {
  const map = new Map<string, { registrations_count: number; pending_count: number }>();
  for (const id of eventIds) map.set(id, { registrations_count: 0, pending_count: 0 });
  if (eventIds.length === 0) return map;

  const { data, error } = await supabase
    .from("event_registrations")
    .select("event_id, status, payment_status")
    .in("event_id", eventIds);

  if (error) {
    // 統計失敗不影響場次列表（回 0），但要在 server log 留下痕跡
    console.warn("[admin/hyrox] 報名統計失敗（回 0）：", error.message);
    return map;
  }

  for (const row of (data as { event_id: string; status: string; payment_status: string }[]) ?? []) {
    if (row.status !== "registered") continue;
    const cur = map.get(row.event_id);
    if (!cur) continue;
    cur.registrations_count += 1;
    if (row.payment_status === "pending_review") cur.pending_count += 1;
  }
  return map;
}

/** 寫入後讓前台／後台快取失效（與 queries.ts 的 tag 對齊） */
function revalidateHyrox() {
  revalidatePath("/hyrox");
  revalidatePath("/admin/hyrox");
  revalidateTag(HYROX_EVENTS_TAG, { expire: 60 });
}

/* =============================================================
 * GET — 後台場次列表（含 draft / archived，附統計）
 * ============================================================= */
export async function GET() {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    // 一頁上限 200：契約沒有分頁參數，超量時明確告知（不靜默截斷）
    const PAGE_LIMIT = 200;

    const { data, error } = await supabase
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("series", HYROX_SERIES)
      .order("event_date", { ascending: false, nullsFirst: false })
      .order("sort_order", { ascending: false })
      .limit(PAGE_LIMIT);

    if (error) return jsonInternal("GET /api/admin/hyrox/events", error);

    const events = (data as unknown as HyroxEvent[]) ?? [];
    const counts = await countRegistrations(
      supabase,
      events.map((e) => e.id)
    );

    const payload: HyroxEventWithCounts[] = events.map((e) => ({
      ...e,
      registrations_count: counts.get(e.id)?.registrations_count ?? 0,
      pending_count: counts.get(e.id)?.pending_count ?? 0,
    }));

    return jsonOk({ events: payload, truncated: events.length >= PAGE_LIMIT });
  } catch (err) {
    return jsonInternal("GET /api/admin/hyrox/events", err);
  }
}

/* =============================================================
 * POST — create / update
 * ============================================================= */
export async function POST(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const action = body.action;
    if (action !== "create" && action !== "update") {
      return jsonValidation({ action: "action 只接受 create 或 update。" });
    }

    const fields: Record<string, string> = {};
    const patch = parseEventFields(body, fields, { partial: action === "update" });

    if (action === "create") {
      if (Object.keys(fields).length > 0) return jsonValidation(fields);

      // end_date 不可早於 event_date（兩者都填時）
      const createDate = (patch.event_date as string | null | undefined) ?? null;
      const createEnd = (patch.end_date as string | null | undefined) ?? null;
      if (createDate && createEnd && createEnd < createDate) {
        return jsonValidation({ end_date: "結束日期不可早於活動日期。" });
      }

      const insertPayload = {
        ...patch,
        // create 時強制系列與預設值（不信任 body 的 series / created_by）
        series: HYROX_SERIES,
        status: (patch.status as EventStatus | undefined) ?? "draft",
        sort_order: (patch.sort_order as number | undefined) ?? 0,
        fee_cents: (patch.fee_cents as number | undefined) ?? 0,
        created_by: actorId,
      };

      const { data, error } = await supabase
        .from("events")
        .insert(insertPayload)
        .select(EVENT_COLUMNS)
        .single();

      if (error) return handleWriteError("POST /api/admin/hyrox/events insert", error);

      revalidateHyrox();

      // 未泛型化的 Supabase client 會把 select 結果推成泛型錯誤型別，
      // 這裡統一經 unknown 轉成領域型別（與既有 admin/events 路由同做法）
      const created = data as unknown as HyroxEvent;

      return jsonOk(
        {
          event: created,
          message: `已建立 HYROX 場次「${created.title}」。`,
        },
        201
      );
    }

    /* ---- update ---- */
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return jsonValidation({ id: "缺少場次編號。" });
    if (!isUuid(id)) return jsonValidation({ id: "編號格式錯誤。" });

    const { data: existing, error: readErr } = await supabase
      .from("events")
      .select("id, series, event_date, end_date, title")
      .eq("id", id)
      .maybeSingle();

    if (readErr) return jsonInternal("POST /api/admin/hyrox/events read", readErr);
    if (!existing || (existing as { series: string | null }).series !== HYROX_SERIES) {
      return jsonNotFound(NOT_FOUND_MSG);
    }

    if (Object.keys(fields).length > 0) return jsonValidation(fields);

    // end_date 不可早於 event_date：以「更新後」的值判定
    const mergedDate = Object.prototype.hasOwnProperty.call(patch, "event_date")
      ? (patch.event_date as string | null)
      : ((existing as { event_date: string | null }).event_date ?? null);
    const mergedEnd = Object.prototype.hasOwnProperty.call(patch, "end_date")
      ? (patch.end_date as string | null)
      : ((existing as { end_date: string | null }).end_date ?? null);
    if (mergedDate && mergedEnd && mergedEnd < mergedDate) {
      return jsonValidation({ end_date: "結束日期不可早於活動日期。" });
    }

    // 不允許透過這支端點改系列或建立者
    delete patch.series;
    delete patch.created_by;

    if (Object.keys(patch).length === 0) {
      // 沒有可寫入的欄位：回目前內容，避免無意義的 update
      const { data } = await supabase
        .from("events")
        .select(EVENT_COLUMNS)
        .eq("id", id)
        .single();
      return jsonOk({
        event: data as unknown as HyroxEvent,
        message: "沒有需要更新的欄位。",
      });
    }

    const { data, error } = await supabase
      .from("events")
      .update(patch)
      .eq("id", id)
      .select(EVENT_COLUMNS)
      .single();

    if (error) return handleWriteError("POST /api/admin/hyrox/events update", error);

    revalidateHyrox();

    const updated = data as unknown as HyroxEvent;

    return jsonOk({
      event: updated,
      message: `已更新 HYROX 場次「${updated.title}」。`,
    });
  } catch (err) {
    return jsonDbError("POST /api/admin/hyrox/events", err);
  }
}

/* =============================================================
 * DELETE — 永久刪除 HYROX 場次（?id=<uuid>）
 *
 * 為什麼要有這支：後台原本只能新增／編輯／上下架，測試或誤建的場次
 * 永遠清不掉（archived 也留著）。這裡補上真刪除，並用兩道閘門擋掉
 * 會造成資料損失的情況：
 *   1. status='published' → 409 PUBLISHED（正在報名中，先下架）
 *   2. event_registrations 有任何一列（不論狀態）→ 409 HAS_REGISTRATIONS
 *      （報名紀錄是有價值的歷史資料，刪場次會連帶 cascade 掉，所以改用下架）
 *
 * 相片（event_photos）由 DB 的 on delete cascade 自動清；
 * Storage 物件（相片 + 封面）在 DB 刪除成功後才 best-effort 清理。
 * ============================================================= */
export async function DELETE(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    // 契約：id 走 query string；缺 id 或格式錯一律 400（不讓 22P02 變成 500）
    const id = (new URL(request.url).searchParams.get("id") ?? "").trim();
    if (!id) return jsonValidation({ id: "缺少場次編號。" });
    if (!isUuid(id)) return jsonValidation({ id: "編號格式錯誤。" });

    const { data: row, error: readErr } = await supabase
      .from("events")
      .select("id,title,status,series,cover_path")
      .eq("id", id)
      .maybeSingle();

    if (readErr) return jsonInternal("DELETE /api/admin/hyrox/events read", readErr);

    const target = row as
      | {
          id: string;
          title: string;
          status: EventStatus;
          series: string | null;
          cover_path: string | null;
        }
      | null;

    // 非 series='hyrox' 一律當作不存在：這支端點不能用來刪一般活動
    if (!target || target.series !== HYROX_SERIES) return jsonNotFound(NOT_FOUND_MSG);

    /* ---- 閘門 1：上架中的場次不可刪 ---- */
    if (target.status === "published") {
      return hyroxErr("PUBLISHED", 409, "此場次正在報名中，請先下架再刪除。");
    }

    /* ---- 閘門 2：有任何報名紀錄就不可刪 ---- */
    const { count, error: countErr } = await supabase
      .from("event_registrations")
      .select("id", { count: "exact", head: true })
      .eq("event_id", id);

    // 統計失敗不可視為 0 放行：寧可擋下，也不要誤刪有報名的場次
    if (countErr) return jsonInternal("DELETE /api/admin/hyrox/events count", countErr);

    const regCount = count ?? 0;
    if (regCount > 0) {
      return hyroxErr(
        "HAS_REGISTRATIONS",
        409,
        `已有 ${regCount} 筆報名紀錄，不能刪除；請改為下架保留紀錄。`
      );
    }

    /* ---- 刪除前先取出相片路徑（DB 列刪掉後就查不到了）---- */
    const photoPaths: string[] = [];
    const { data: photoRows, error: photoErr } = await supabase
      .from("event_photos")
      .select("path")
      .eq("event_id", id);

    if (photoErr) {
      // 讀不到相片清單不擋刪除（DB 列仍會 cascade），只是無法清 Storage 物件
      console.warn(
        "[admin/hyrox/events] 讀取相片路徑失敗（不擋主流程）：",
        photoErr.message
      );
    } else {
      for (const p of (photoRows as { path: string }[] | null) ?? []) {
        if (typeof p.path === "string" && p.path !== "") photoPaths.push(p.path);
      }
    }

    // 封面也是這個場次自己的物件，跟著一起清
    const storagePaths = target.cover_path ? [...photoPaths, target.cover_path] : photoPaths;
    const photosRemoved = photoPaths.length;

    /* ---- 刪 DB（event_photos 由 on delete cascade 自動清）---- */
    const { data: deleted, error: delErr } = await supabase
      .from("events")
      .delete()
      .eq("id", id)
      .eq("series", HYROX_SERIES)
      .select("id");

    if (delErr) {
      // 23503：仍有其他資料引用此場次（例如非 cascade 的外部鍵）→ 409，不吐 500
      const code =
        typeof delErr === "object" && delErr !== null && "code" in delErr
          ? String((delErr as { code?: unknown }).code ?? "")
          : "";
      if (code === "23503") {
        return jsonConflict("此場次仍被其他資料引用，無法刪除；請改為下架保留。");
      }
      return jsonInternal("DELETE /api/admin/hyrox/events delete", delErr);
    }

    // 併發：別的請求已經刪掉了
    if (!deleted || (deleted as { id: string }[]).length === 0) {
      return jsonNotFound(NOT_FOUND_MSG);
    }

    /* ---- Storage 物件：best-effort，失敗只記 log ---- */
    let storageDeleted = storagePaths.length === 0;
    if (storagePaths.length > 0) {
      try {
        const { error: storageErr } = await supabase.storage
          .from(SITE_ASSETS)
          .remove(storagePaths);
        if (storageErr) {
          console.warn(
            "[admin/hyrox/events] Storage 刪除失敗（不擋主流程）：",
            storageErr.message
          );
        } else {
          storageDeleted = true;
        }
      } catch (err) {
        console.warn("[admin/hyrox/events] Storage 刪除例外（不擋主流程）：", err);
      }
    }

    revalidateHyrox();

    await writeAuditLog(
      supabase,
      actorId,
      "hyrox",
      "event-delete",
      `刪除 HYROX 場次「${target.title}」（相片 ${photosRemoved} 張${
        storageDeleted ? "" : "，Storage 物件待清理"
      }）`
    );

    return jsonOk({
      removed: id,
      title: target.title,
      photos_removed: photosRemoved,
      storage_deleted: storageDeleted,
      message: `已刪除 HYROX 場次「${target.title}」。`,
    });
  } catch (err) {
    return jsonDbError("DELETE /api/admin/hyrox/events", err);
  }
}

/** H6：未實作的方法也要回 JSON */
export async function PUT() {
  return jsonMethodNotAllowed();
}
export const PATCH = PUT;
