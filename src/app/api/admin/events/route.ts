/**
 * /api/admin/events — 活動 CRUD（管理員限定）
 *
 * POST   新增活動（created_by 由伺服器帶入，前端不得提供）→ 201
 * PATCH  完整更新 或 statusOnly 上下架/復原 → 200
 * DELETE 軟刪除（status='archived'，不動 Storage 物件）→ 200
 *
 * 契約：SPEC-R6.md §2.1（權限）、§2.3（POST）、§2.4（PATCH）、§2.5（DELETE）
 * Owner：白客
 *
 * H4：每支 API 開頭一律「isSupabaseConfigured → 身分 → requireAdmin」。
 * H6：全部包 try/catch，任何情況都回 JSON。
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  jsonBadJson,
  jsonConflict,
  jsonForbidden,
  jsonInternal,
  jsonNotFound,
  jsonNotConfigured,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";
import type { Event, EventStatus } from "@/lib/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COVER_RE = /^events\/[A-Za-z0-9][A-Za-z0-9/_.-]*\.(jpg|jpeg|png|webp)$/;
const URL_SAFE_RE = /^(https?:\/\/|mailto:|tel:)/i;
const SITE_ASSETS = "site-assets";

type Supabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;

/** 找不到活動時的統一文案（見 §2.4/§2.5，覆蓋 §0.4 的通案文案） */
const NOT_FOUND_MSG = "找不到這筆活動。";

function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  return !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

/** H4：IsSupabaseConfigured → 未登入 401 → 非管理員 403 */
async function authorizeAdmin() {
  if (!isSupabaseConfigured) return { res: jsonNotConfigured() } as const;

  const supabase = await createClient();
  if (!supabase) return { res: jsonNotConfigured() } as const;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { res: jsonUnauthenticated() } as const;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { res: jsonForbidden() } as const;

  return { supabase, admin: { id: user.id } } as const;
}

type Authorized = Awaited<ReturnType<typeof authorizeAdmin>>;

/**
 * Storage 存在性檢查（§2.3 第 10 步／§2.6 第 2 步）。
 * 確認前端送來的 object path 真的存在（避免 DB 指到不存在的圖）。
 * 寫入權限另由 bucket policy 的 is_admin() 把關。
 */
async function storageExists(supabase: Supabase, path: string): Promise<boolean> {
  const idx = path.lastIndexOf("/");
  const dir = idx === -1 ? "" : path.slice(0, idx);
  const base = path.slice(idx + 1);

  const { data, error } = await supabase.storage.from(SITE_ASSETS).list(dir, {
    search: base,
    limit: 20,
  });

  if (error || !data?.length) return false;
  return data.some((o) => o.name === base);
}

/** 共用文字欄位驗證：一律 trim + 長度上限，超限寫入 fields */
function text(
  body: Record<string, unknown>,
  key: string,
  maxLen: number,
  fields: Record<string, string>,
  message: string
): string | null {
  const raw = body[key];
  if (raw === undefined) return null;
  if (raw === null) return null;
  if (typeof raw !== "string") {
    fields[key] = message;
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.length > maxLen) {
    fields[key] = message;
    return null;
  }
  return trimmed;
}

/** 逐欄驗證；違規時寫入 fields，合法的結果放進 value */
function parseEventFields(
  body: Record<string, unknown>,
  fields: Record<string, string>,
  opts: { partial: boolean }
): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  const provided = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  // 2) event_date
  if (provided("event_date") || !opts.partial) {
    const raw = String(body.event_date ?? "").trim();
    if (!isRealDate(raw)) {
      fields.event_date = "請選擇正確的活動日期。";
    } else {
      value.event_date = raw;
    }
  }

  // 3) end_date
  if (provided("end_date")) {
    const raw = String(body.end_date ?? "").trim();
    if (raw !== "") {
      if (!isRealDate(raw)) {
        fields.end_date = "請選擇正確的活動日期。";
      } else if (value.event_date && raw < (value.event_date as string)) {
        fields.end_date = "結束日期不可早於活動日期。";
      } else {
        value.end_date = raw;
      }
    } else {
      value.end_date = null;
    }
  }

  // 4) start_time / end_time
  const timeMsg = "時間請填 20 字以內，例如 19:30。";
  if (provided("start_time")) {
    const t = body.start_time;
    if (t === null || t === undefined || String(t).trim() === "") value.start_time = null;
    else if (typeof t === "string" && t.trim().length <= 20) value.start_time = t.trim();
    else fields.start_time = timeMsg;
  }
  if (provided("end_time")) {
    const t = body.end_time;
    if (t === null || t === undefined || String(t).trim() === "") value.end_time = null;
    else if (typeof t === "string" && t.trim().length <= 20) value.end_time = t.trim();
    else fields.end_time = timeMsg;
  }

  // 5) 其餘文字欄位
  const sub = text(body, "subtitle", 200, fields, "副標請填 200 字以內。");
  if (sub !== null || provided("subtitle")) value.subtitle = sub;
  const bodyText = text(body, "body", 5000, fields, "活動內容請填 5000 字以內。");
  if (bodyText !== null || provided("body")) value.body = bodyText;
  const loc = text(body, "location", 120, fields, "地點請填 120 字以內。");
  if (loc !== null || provided("location")) value.location = loc;
  const note = text(body, "registration_note", 300, fields, "報名方式請填 300 字以內。");
  if (note !== null || provided("registration_note")) value.registration_note = note;

  // 6) capacity
  if (provided("capacity")) {
    const raw = body.capacity;
    if (raw === null || raw === undefined || raw === "" ) {
      value.capacity = null;
    } else {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isInteger(n) || n < 1 || n > 99999) {
        fields.capacity = "名額請填 1–99999 的整數。";
      } else {
        value.capacity = n;
      }
    }
  }

  // 7) registration_url（含 javascript: 一律拒絕，只認白名單 scheme）
  if (provided("registration_url")) {
    const raw = body.registration_url;
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      value.registration_url = null;
    } else if (typeof raw === "string" && URL_SAFE_RE.test(raw.trim())) {
      const trimmed = raw.trim();
      if (trimmed.length > 500) fields.registration_url = "報名連結請填 500 字以內。";
      else value.registration_url = trimmed;
    } else {
      fields.registration_url = "報名連結請用 https://、mailto: 或 tel: 開頭。";
    }
  }

  // 8) 至少一種報名方式：以「本次結果」判定（PUT 時用 merged 值）
  const urlOk = value.registration_url ?? null;
  const noteOk = value.registration_note ?? null;
  const bothAbsent = !urlOk && !noteOk;
  const bothProvidedAndEmpty =
    provided("registration_url") &&
    provided("registration_note") &&
    !urlOk &&
    !noteOk;
  if (bothAbsent && (bothProvidedAndEmpty || !opts.partial)) {
    fields.registration_note = "請填寫報名連結或報名方式（至少一種）。";
  }

  // 9) cover_path
  if (provided("cover_path")) {
    const raw = body.cover_path;
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      value.cover_path = null;
    } else if (typeof raw === "string" && COVER_RE.test(raw.trim())) {
      value.cover_path = raw.trim();
    } else {
      fields.cover_path = "封面圖片格式錯誤，請重新上傳。";
    }
  }

  // 11) status
  if (provided("status")) {
    const s = body.status;
    if (typeof s === "string" && ["draft", "published", "archived"].includes(s)) {
      value.status = s as EventStatus;
    } else {
      fields.status = "上下架狀態錯誤。";
    }
  }

  // sort_order
  if (provided("sort_order")) {
    const n = Number(String(body.sort_order ?? "").trim());
    value.sort_order = Number.isInteger(n) && n >= -9999 && n <= 9999 ? n : 0;
  }

  return value;
}

/* =============================================================
 * POST — 新增活動
 * ============================================================= */
export async function POST(request: Request) {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, admin } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const fields: Record<string, string> = {};

    // 1) title
    const rawTitle = body.title;
    const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
    if (title.length < 1 || title.length > 120) {
      fields.title = "請填寫活動標題（1–120 字）。";
    }

    const value = parseEventFields(body, fields, { partial: false });

    if (Object.keys(fields).length > 0) return jsonValidation(fields);

    // 10) 封面 Storage 存在性檢查
    if (typeof value.cover_path === "string") {
      const exists = await storageExists(supabase, value.cover_path);
      if (!exists) {
        return jsonValidation({ cover_path: "封面圖片不存在，請重新上傳。" });
      }
    }

    const insertPayload = {
      title,
      subtitle: (value.subtitle ?? null) as string | null,
      body: (value.body ?? null) as string | null,
      event_date: value.event_date as string,
      end_date: (value.end_date ?? null) as string | null,
      start_time: (value.start_time ?? null) as string | null,
      end_time: (value.end_time ?? null) as string | null,
      location: (value.location ?? null) as string | null,
      capacity: (value.capacity ?? null) as number | null,
      registration_url: (value.registration_url ?? null) as string | null,
      registration_note: (value.registration_note ?? null) as string | null,
      cover_path: (value.cover_path ?? null) as string | null,
      status: ((value.status as EventStatus | undefined) ?? "draft") as EventStatus,
      sort_order: (value.sort_order as number | undefined) ?? 0,
      // created_by 由伺服器帶入，前端不得提供（§1.2）
      created_by: admin.id,
    };

    const { data, error } = await supabase
      .from("events")
      .insert(insertPayload)
      .select()
      .single();

    if (error) return jsonInternal("POST /api/admin/events insert", error);

    revalidatePath("/events");
    revalidatePath("/admin/events");
    revalidatePath("/");

    return jsonOk(
      { data: data as Event, message: `已建立活動「${title}」。` },
      201
    );
  } catch (err) {
    return jsonInternal("POST /api/admin/events", err);
  }
}

/* =============================================================
 * PATCH — 完整更新 / statusOnly 上下架
 * ============================================================= */
export async function PATCH(request: Request) {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!UUID_RE.test(id)) return jsonValidation({}, NOT_FOUND_MSG);

    const { data: existing, error: readErr } = await supabase
      .from("events")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (readErr) return jsonInternal("PATCH /api/admin/events read", readErr);
    if (!existing) return jsonNotFound(NOT_FOUND_MSG);

    const old = existing as Event;

    /* --- (b) 只改上下架／復原 --- */
    if (body.statusOnly === true) {
      const status = body.status;
      if (typeof status !== "string" || !["draft", "published", "archived"].includes(status)) {
        return jsonValidation({ status: "上下架狀態錯誤。" });
      }

      const { data, error } = await supabase
        .from("events")
        .update({ status: status as EventStatus })
        .eq("id", id)
        .select()
        .single();

      if (error) return jsonInternal("PATCH /api/admin/events toggle", error);

      revalidatePath("/events");
      revalidatePath("/admin/events");
      revalidatePath("/");

      const message =
        status === "published" ? "已上架。" : status === "archived" ? "已下架。" : "已下架。";

      return jsonOk({ data: data as Event, message });
    }

    /* --- (a) 完整更新：有提供的欄位才驗證 --- */
    const fields: Record<string, string> = {};

    const rawTitle = body.title;
    let nextTitle: string | null = null;
    if (Object.prototype.hasOwnProperty.call(body, "title")) {
      if (typeof rawTitle !== "string" || rawTitle.trim().length < 1 || rawTitle.trim().length > 120) {
        fields.title = "請填寫活動標題（1–120 字）。";
      } else {
        nextTitle = rawTitle.trim();
      }
    }

    const patch = parseEventFields(body, fields, { partial: true });
    if (nextTitle !== null) patch.title = nextTitle;

    if (Object.keys(fields).length > 0) return jsonValidation(fields);

    // DB constraint 是事情的最後防線，這裡先擋掉，避免使用者看到 500
    const mergedEventDate =
      (Object.prototype.hasOwnProperty.call(patch, "event_date")
        ? (patch.event_date as string)
        : old.event_date) ?? old.event_date;
    const mergedEndDate = Object.prototype.hasOwnProperty.call(patch, "end_date")
      ? (patch.end_date as string | null)
      : old.end_date;
    if (mergedEndDate && mergedEndDate < mergedEventDate) {
      return jsonValidation({ end_date: "結束日期不可早於活動日期。" });
    }

    // 「至少一種報名方式」要以更新後的結果判定
    if (
      Object.prototype.hasOwnProperty.call(patch, "registration_url") ||
      Object.prototype.hasOwnProperty.call(patch, "registration_note")
    ) {
      const mergedUrl = Object.prototype.hasOwnProperty.call(patch, "registration_url")
        ? (patch.registration_url as string | null)
        : old.registration_url;
      const mergedNote = Object.prototype.hasOwnProperty.call(patch, "registration_note")
        ? (patch.registration_note as string | null)
        : old.registration_note;
      if (!mergedUrl && !mergedNote) {
        return jsonValidation({
          registration_note: "請填寫報名連結或報名方式（至少一種）。",
        });
      }
    }

    /* --- cover_path 處理（換圖 / 移除） --- */
    const wantsRemoveCover =
      Object.prototype.hasOwnProperty.call(body, "cover_path") &&
      (body.cover_path === null || String(body.cover_path).trim() === "");

    let newCoverPath: string | null = old.cover_path;
    let shouldDeleteOld = false;

    if (wantsRemoveCover) {
      // 移除封面需要前端同時帶 removeCover:true（UI 已彈確認框）。
      // 未帶確認時「忽略這個欄位」，避免誤觸就遺失封面。
      if (body.removeCover === true && old.cover_path) {
        newCoverPath = null;
        patch.cover_path = null;
        shouldDeleteOld = true;
      } else {
        delete patch.cover_path;
      }
    } else if (typeof patch.cover_path === "string") {
      if (patch.cover_path !== old.cover_path) {
        const exists = await storageExists(supabase, patch.cover_path);
        if (!exists) {
          // 先查後寫：不符合就不寫 DB（BE-10 ②）
          return jsonValidation({ cover_path: "封面圖片不存在，請重新上傳。" });
        }
        newCoverPath = patch.cover_path;
        shouldDeleteOld = Boolean(old.cover_path);
      }
    }

    delete patch.created_by;
    delete patch.id;

    let updated: Event = old;

    if (Object.keys(patch).length > 0) {
      const { data, error } = await supabase
        .from("events")
        .update(patch)
        .eq("id", id)
        .select()
        .single();

      if (error) return jsonInternal("PATCH /api/admin/events update", error);
      updated = data as Event;
    }

    // DB 成功後才刪舊圖：best-effort，失敗只 warn，不影響使用者
    if (shouldDeleteOld && old.cover_path && old.cover_path !== newCoverPath) {
      const { error: rmErr } = await supabase.storage
        .from(SITE_ASSETS)
        .remove([old.cover_path]);
      if (rmErr) console.warn("[events] 移除舊封面失敗（可忽略）：", rmErr.message);
    }

    revalidatePath("/events");
    revalidatePath("/admin/events");
    revalidatePath("/");

    return jsonOk({ data: updated, message: `已更新活動「${updated.title}」。` });
  } catch (err) {
    return jsonInternal("PATCH /api/admin/events", err);
  }
}

/* =============================================================
 * DELETE — 軟刪除（archived），不刪 Storage 物件
 * ============================================================= */
export async function DELETE(request: Request) {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!UUID_RE.test(id)) return jsonValidation({}, NOT_FOUND_MSG);

    if (body.confirm !== true) {
      return jsonValidation({}, "請先勾選「確認下架此活動」再執行。");
    }

    const { data: row, error: readErr } = await supabase
      .from("events")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (readErr) return jsonInternal("DELETE /api/admin/events read", readErr);
    if (!row) return jsonNotFound(NOT_FOUND_MSG);
    if ((row as { status: EventStatus }).status === "archived") {
      return jsonConflict("此活動已下架。");
    }

    const { error } = await supabase
      .from("events")
      .update({ status: "archived" as EventStatus })
      .eq("id", id);

    if (error) return jsonInternal("DELETE /api/admin/events update", error);

    revalidatePath("/events");
    revalidatePath("/admin/events");
    revalidatePath("/");

    return jsonOk({ message: "活動已下架，可在「已下架」清單復原。" });
  } catch (err) {
    return jsonInternal("DELETE /api/admin/events", err);
  }
}
