/**
 * GET  /api/admin/training/rules — 全部週期規則（帶課程名）
 * POST /api/admin/training/rules — { action: 'create' | 'update' | 'delete', ... }
 *
 * 權限：authorizeAdmin()（未設定 400 / 未登入 401 / 非管理員 403）
 * 資料表：public.training_rules（supabase/migration-training-schedule.sql B 段）
 *
 * 語意：一條規則 = 「某課程 每週第 N 天 從 HH:MM 到 HH:MM」。
 * 場次不是由規則即時推導，而是由 generate_sessions / generate_month 落地成
 * training_sessions 列（客戶要在後台逐場取消／改場地，所以必須落地）。
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
  isForeignKeyViolation,
  isValidDate,
  jsonTrainingDbError,
  normalizeTime,
  revalidateTrainingSchedule,
  requireUuid,
  text,
  type Supabase,
} from "../_shared";

const LIMITS = { location: 120, coachName: 60 } as const;

/** 澳門當天日期（YYYY-MM-DD）：valid_from 的預設值，不能用伺服器 UTC 日期 */
function todayMacau(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Macau",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET() {
  try {
    const auth = await authorizeAdmin();
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const { data, error } = await supabase
      .from("training_rules")
      .select(
        "id, class_id, weekday, start_time, end_time, location, coach_name, capacity, valid_from, valid_to, is_active, created_at, class:training_classes(name)"
      )
      .order("weekday", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) return jsonTrainingDbError("GET /api/admin/training/rules", error);

    type Row = {
      class: { name: string | null } | null;
      [key: string]: unknown;
    };

    const rules = ((data ?? []) as unknown as Row[]).map((row) => {
      const { class: cls, ...rest } = row;
      return { ...rest, class_name: cls?.name ?? null };
    });

    return jsonOk({ rules, count: rules.length });
  } catch (err) {
    return jsonInternal("GET /api/admin/training/rules", err);
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
    if (action === "delete") return removeRule(supabase, userId, body);
    if (action !== "create" && action !== "update") {
      return jsonValidation({}, "不支援的操作，action 必須是 create、update 或 delete。");
    }

    /* ---------- 欄位驗證 ---------- */
    const id = action === "update" ? requireUuid(body.id) : null;
    if (action === "update" && !id) return jsonValidation({}, "缺少有效的規則 id。");

    const classId = requireUuid(body.class_id);
    if (!classId)
      return jsonValidation({ class_id: "請選擇課程。" }, "請檢查表單內容。");

    const weekdayNum = Number(body.weekday);
    if (!Number.isInteger(weekdayNum) || weekdayNum < 1 || weekdayNum > 7) {
      return jsonValidation(
        { weekday: "星期需為 1（星期一）到 7（星期日）。" },
        "請檢查表單內容。"
      );
    }

    const startTime = normalizeTime(body.start_time);
    if (!startTime)
      return jsonValidation({ start_time: "開始時間格式需為 HH:MM。" }, "請檢查表單內容。");

    const endTime = normalizeTime(body.end_time);
    if (!endTime)
      return jsonValidation({ end_time: "結束時間格式需為 HH:MM。" }, "請檢查表單內容。");

    if (endTime <= startTime) {
      return jsonValidation(
        { end_time: "結束時間必須晚於開始時間（不支援跨夜課程）。" },
        "請檢查表單內容。"
      );
    }

    const location = text(body.location);
    if (location.length > LIMITS.location)
      return jsonValidation({ location: "場地名稱過長（上限 120 字）。" }, "請檢查表單內容。");

    const coachName = text(body.coach_name);
    if (coachName.length > LIMITS.coachName)
      return jsonValidation({ coach_name: "教練名稱過長（上限 60 字）。" }, "請檢查表單內容。");

    let capacity: number | null = null;
    if (body.capacity !== undefined && body.capacity !== null && body.capacity !== "") {
      const n = Number(body.capacity);
      if (!Number.isFinite(n) || n < 1 || n > 999) {
        return jsonValidation({ capacity: "名額需介於 1 與 999 之間。" }, "請檢查表單內容。");
      }
      capacity = Math.trunc(n);
    }

    const validFrom = text(body.valid_from) || todayMacau();
    if (!isValidDate(validFrom))
      return jsonValidation({ valid_from: "生效日期格式需為 YYYY-MM-DD。" }, "請檢查表單內容。");

    const validToRaw = text(body.valid_to);
    let validTo: string | null = null;
    if (validToRaw) {
      if (!isValidDate(validToRaw))
        return jsonValidation({ valid_to: "結束日期格式需為 YYYY-MM-DD。" }, "請檢查表單內容。");
      if (validToRaw < validFrom)
        return jsonValidation(
          { valid_to: "結束日期不可早於生效日期。" },
          "請檢查表單內容。"
        );
      validTo = validToRaw;
    }

    const payload = {
      class_id: classId,
      weekday: weekdayNum,
      start_time: startTime,
      end_time: endTime,
      location: location || null,
      coach_name: coachName || null,
      capacity,
      valid_from: validFrom,
      valid_to: validTo,
      is_active: body.is_active !== false,
    };

    /* ---------- 寫入 ---------- */
    if (action === "update" && id) {
      const { data, error } = await supabase
        .from("training_rules")
        .update(payload)
        .eq("id", id)
        .select("id")
        .maybeSingle();

      if (isForeignKeyViolation(error))
        return jsonValidation({ class_id: "找不到這門課。" }, "請檢查表單內容。");
      if (error) return jsonTrainingDbError("POST /api/admin/training/rules update", error);
      if (!data) return jsonNotFound("找不到這條規則。");

      revalidateTrainingSchedule();
      await writeAuditLog(
        supabase,
        userId,
        "training",
        "update",
        `更新週期規則（星期${weekdayNum} ${startTime.slice(0, 5)}–${endTime.slice(0, 5)}）`
      );
      return jsonOk({ message: "週期規則已更新。", id });
    }

    // 重複規則防護：同一門課 + 同一 weekday + 同一開始時間只留一條，
    // 否則生成器會算出兩個相同候選，唯一索引會擋掉第二個（created 數會對不上）。
    const { count: duplicate, error: dupError } = await supabase
      .from("training_rules")
      .select("id", { count: "exact", head: true })
      .eq("class_id", classId)
      .eq("weekday", weekdayNum)
      .eq("start_time", startTime);

    if (dupError) return jsonTrainingDbError("POST /api/admin/training/rules dup", dupError);
    if ((duplicate ?? 0) > 0)
      return jsonConflict("這門課在同一天、同一開始時間已有規則。");

    const { data, error } = await supabase
      .from("training_rules")
      .insert(payload)
      .select("id")
      .maybeSingle();

    if (isForeignKeyViolation(error))
      return jsonValidation({ class_id: "找不到這門課。" }, "請檢查表單內容。");
    if (error) return jsonTrainingDbError("POST /api/admin/training/rules insert", error);

    revalidateTrainingSchedule();
    await writeAuditLog(
      supabase,
      userId,
      "training",
      "create",
      `新增週期規則（星期${weekdayNum} ${startTime.slice(0, 5)}–${endTime.slice(0, 5)}）`
    );
    return jsonOk({ message: "週期規則已新增。", id: data?.id ?? null });
  } catch (err) {
    return jsonInternal("POST /api/admin/training/rules", err);
  }
}

/**
 * 刪除規則。
 * 只刪規則本身；已生成的場次刻意保留（客戶可能已經有人報名／簽到），
 * 需要清場次請到場次管理處理 —— 這樣才不會一次誤刪整月份的歷史紀錄。
 */
async function removeRule(
  supabase: Supabase,
  userId: string,
  body: Record<string, unknown>
): Promise<Response> {
  const id = requireUuid(body.id);
  if (!id) return jsonValidation({ id: "缺少有效的規則 id。" }, "請檢查表單內容。");

  const { data, error } = await supabase
    .from("training_rules")
    .delete()
    .eq("id", id)
    .select("id, weekday, start_time");

  if (error) return jsonTrainingDbError("POST /api/admin/training/rules delete", error);
  if (!data || data.length === 0) return jsonNotFound("找不到這條規則。");

  const removed = data[0] as { weekday?: number; start_time?: string };
  revalidateTrainingSchedule();
  await writeAuditLog(
    supabase,
    userId,
    "training",
    "delete",
    `刪除週期規則（星期${removed.weekday ?? "?"} ${(removed.start_time ?? "").slice(0, 5)}）`
  );
  return jsonOk({ message: "週期規則已刪除。", id });
}

/** 未實作的 HTTP 方法一律回 JSON（H6） */
export async function PUT() {
  return jsonMethodNotAllowed();
}

export async function DELETE() {
  return jsonMethodNotAllowed();
}

export async function PATCH() {
  return jsonMethodNotAllowed();
}
