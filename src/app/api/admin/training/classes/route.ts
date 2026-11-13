/**
 * GET  /api/admin/training/classes — 全部課程（含停用的，後台要能重新啟用）
 * POST /api/admin/training/classes — { action: 'create' | 'update' | 'delete', ... }
 *
 * 權限：authorizeAdmin()（未設定 400 / 未登入 401 / 非管理員 403）
 * 資料表：public.training_classes（supabase/migration-training-schedule.sql A 段）
 *
 * Owner：白客（backend-engineer）
 */

import { writeAuditLog } from "@/lib/audit";
import {
  jsonBadJson,
  jsonConflict,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";
import {
  authorizeAdmin,
  clampInt,
  isForeignKeyViolation,
  isUniqueViolation,
  jsonTrainingDbError,
  revalidateTrainingSchedule,
  requireUuid,
  SLUG_RE,
  text,
  type Supabase,
} from "../_shared";

/** 日曆上的 8 類課（與 DB 的 check 一致；DB 是第二道防線，這裡先擋） */
const CATEGORIES = ["strength", "hyrox", "running", "skill", "internal", "outdoor"] as const;
type Category = (typeof CATEGORIES)[number];

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

/** 上限（字元數）：避免超長字串打爆 DB 與後台列表 */
const LIMITS = {
  name: 60,
  slug: 40,
  colorKey: 20,
  coachName: 60,
  location: 120,
  description: 2000,
} as const;

/** 409：課程仍被場次引用（語意碼 IN_USE，見回報說明） */
function jsonErrInUse(used: number): Response {
  const message =
    used > 0
      ? `這門課仍有 ${used} 場次引用，請先刪除或改綁那些場次。`
      : "這門課仍被場次引用，無法刪除。";
  return jsonConflict(message);
}

export async function GET() {
  try {
    const auth = await authorizeAdmin();
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const { data, error } = await supabase
      .from("training_classes")
      .select(
        "id, slug, name, category, color_key, duration_min, capacity, coach_name, location, description, is_active, sort_order, created_at"
      )
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) return jsonTrainingDbError("GET /api/admin/training/classes", error);

    const classes = data ?? [];
    return jsonOk({ classes, count: classes.length });
  } catch (err) {
    return jsonInternal("GET /api/admin/training/classes", err);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if ("res" in auth) return auth.res;
    const { supabase, userId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const action = text(body.action);

    if (action === "delete") return removeClass(supabase, userId, body);
    if (action !== "create" && action !== "update") {
      return jsonValidation({}, "不支援的操作，action 必須是 create、update 或 delete。");
    }

    /* ---------- 欄位驗證 ---------- */
    const id = action === "update" ? requireUuid(body.id) : null;
    if (action === "update" && !id) return jsonValidation({}, "缺少有效的課程 id。");

    const name = text(body.name);
    if (!name) return jsonValidation({ name: "請填寫課程名稱。" }, "請檢查表單內容。");
    if (name.length > LIMITS.name)
      return jsonValidation(
        { name: `課程名稱過長（上限 ${LIMITS.name} 字）。` },
        "請檢查表單內容。"
      );

    const slug = text(body.slug);
    if (action === "create" && !slug) {
      return jsonValidation({ slug: "請填寫課程代號。" }, "請檢查表單內容。");
    }
    if (slug && (slug.length > LIMITS.slug || !SLUG_RE.test(slug))) {
      return jsonValidation(
        { slug: "課程代號只能用小寫英數字與連字號，長度 1–40。" },
        "請檢查表單內容。"
      );
    }

    if (!isCategory(body.category)) {
      return jsonValidation({ category: "請選擇有效的課程分類。" }, "請檢查表單內容。");
    }

    const colorKey = text(body.color_key);
    if (colorKey.length > LIMITS.colorKey)
      return jsonValidation({ color_key: "顏色代號過長（上限 20 字）。" }, "請檢查表單內容。");

    const coachName = text(body.coach_name);
    if (coachName.length > LIMITS.coachName)
      return jsonValidation({ coach_name: "教練名稱過長（上限 60 字）。" }, "請檢查表單內容。");

    const location = text(body.location);
    if (location.length > LIMITS.location)
      return jsonValidation({ location: "場地名稱過長（上限 120 字）。" }, "請檢查表單內容。");

    const description = text(body.description);
    if (description.length > LIMITS.description)
      return jsonValidation(
        { description: "課程簡介過長（上限 2000 字）。" },
        "請檢查表單內容。"
      );

    // duration_min：允許 null（未設定）；有值時必須落在 5–600 分鐘
    let durationMin: number | null = null;
    if (body.duration_min !== undefined && body.duration_min !== null && body.duration_min !== "") {
      const n = Number(body.duration_min);
      if (!Number.isFinite(n) || n < 5 || n > 600) {
        return jsonValidation(
          { duration_min: "課程長度需介於 5 與 600 分鐘。" },
          "請檢查表單內容。"
        );
      }
      durationMin = Math.trunc(n);
    }

    // capacity：允許 null；有值時 1–999
    let capacity: number | null = null;
    if (body.capacity !== undefined && body.capacity !== null && body.capacity !== "") {
      const n = Number(body.capacity);
      if (!Number.isFinite(n) || n < 1 || n > 999) {
        return jsonValidation({ capacity: "名額需介於 1 與 999 之間。" }, "請檢查表單內容。");
      }
      capacity = Math.trunc(n);
    }

    const payload = {
      name,
      ...(slug ? { slug } : {}),
      category: body.category,
      color_key: colorKey || null,
      duration_min: durationMin,
      capacity,
      coach_name: coachName || null,
      location: location || null,
      description: description || null,
      is_active: body.is_active !== false,
      sort_order: clampInt(body.sort_order, 0, -9999, 9999),
    };

    /* ---------- 寫入 ---------- */
    if (action === "update" && id) {
      const { data, error } = await supabase
        .from("training_classes")
        .update(payload)
        .eq("id", id)
        .select("id")
        .maybeSingle();

      if (isUniqueViolation(error)) return jsonConflict("這個課程代號已被其他課程使用。");
      if (error) return jsonTrainingDbError("POST /api/admin/training/classes update", error);
      if (!data) return jsonNotFound("找不到這門課程。");

      revalidateTrainingSchedule();
      await writeAuditLog(supabase, userId, "training", "update", `更新課程「${name}」`);
      return jsonOk({ message: "課程已更新。", id });
    }

    const { data, error } = await supabase
      .from("training_classes")
      .insert(payload)
      .select("id")
      .maybeSingle();

    if (isUniqueViolation(error)) return jsonConflict("這個課程代號已被其他課程使用。");
    if (error) return jsonTrainingDbError("POST /api/admin/training/classes insert", error);

    revalidateTrainingSchedule();
    await writeAuditLog(supabase, userId, "training", "create", `新增課程「${name}」`);
    return jsonOk({ message: "課程已新增。", id: data?.id ?? null });
  } catch (err) {
    return jsonInternal("POST /api/admin/training/classes", err);
  }
}

/**
 * 刪除課程。
 * 已被場次引用 → 409（語意 IN_USE），不讓資料靜默消失：
 * training_sessions.class_id 沒有 on delete cascade（刻意），硬刪會被 FK 擋；
 * 這裡先查一次並回可讀訊息，避免把 23503 變成 500。
 * 週期規則（training_rules.class_id）是 on delete cascade，會跟著課程一起刪。
 */
async function removeClass(
  supabase: Supabase,
  userId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const id = requireUuid(body.id);
  if (!id) return jsonValidation({ id: "缺少有效的課程 id。" }, "請檢查表單內容。");

  const { count, error: countError } = await supabase
    .from("training_sessions")
    .select("id", { count: "exact", head: true })
    .eq("class_id", id);

  if (countError) return jsonTrainingDbError("POST /api/admin/training/classes count", countError);

  const used = count ?? 0;
  if (used > 0) return jsonErrInUse(used);

  const { data: existing } = await supabase
    .from("training_classes")
    .select("name")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return jsonNotFound("找不到這門課程。");

  const { error } = await supabase.from("training_classes").delete().eq("id", id);
  if (isForeignKeyViolation(error)) return jsonErrInUse(used);
  if (error) return jsonTrainingDbError("POST /api/admin/training/classes delete", error);

  revalidateTrainingSchedule();
  await writeAuditLog(
    supabase,
    userId,
    "training",
    "delete",
    `刪除課程「${existing?.name ?? id}」`
  );
  return jsonOk({ message: "課程已刪除。", id });
}

/** 未實作的 HTTP 方法一律回 JSON（H6：不要讓框架回 405 空 body） */
export async function PUT() {
  return jsonMethodNotAllowed();
}

export async function DELETE() {
  return jsonMethodNotAllowed();
}

export async function PATCH() {
  return jsonMethodNotAllowed();
}
