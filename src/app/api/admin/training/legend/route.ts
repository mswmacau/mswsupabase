/**
 * GET  /api/admin/training/legend — 全部顏色圖例（含停用）
 * POST /api/admin/training/legend — { action:'update', color_key, label?, sort_order?, is_active? }
 *                                   { action:'reset' }（還原 6 筆預設文案）
 *
 * 契約：supabase/migration-schedule-legend.sql（schedule_legend 為唯一真相）
 *
 * 【為什麼是「顏色」不是「課程」】
 * 前台日曆畫的是顏色短條（手機格子放不下課名），而 8 門課共用 6 個顏色
 * （amber = Hyrox Foundation / Power / Engine）。以一門課一列會出現三行相同的
 * amber 說明，所以主鍵是 color_key，圖例以顏色為單位。
 *
 * 【為什麼不提供 create / delete】
 * 顏色集合是固定的 6 個（見 COLOR_KEYS 與 DB 的 check 約束）：
 * 前台只認得這 6 個色票鍵，讓後台新增第 7 個顏色等於新增一條永遠畫不出來的圖例。
 * 要「移除」某個顏色請用 is_active:false；要復原改壞的文案用 action:'reset'。
 *
 * 權限：authorizeAdmin()（未設定 400 / 未登入 401 / 非管理員 403）
 * 註：RLS 是第二道防線（legend_admin_all 用 is_admin()）。
 *
 * Owner：白客（backend-engineer）
 */

import { writeAuditLog } from "@/lib/audit";
import {
  jsonBadJson,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";
import {
  authorizeAdmin,
  jsonTrainingDbError,
  revalidateTrainingSchedule,
  text,
  type Supabase,
} from "../_shared";

const MIGRATION = "supabase/migration-schedule-legend.sql";

/**
 * 固定色票鍵（與 migration 的 schedule_legend_color_key_check 一字不差）。
 * 前台依這 6 個 key 決定顏色，DB 與 API 兩層都擋不存在的值。
 */
const COLOR_KEYS = ["blue", "green", "amber", "teal", "violet", "orange"] as const;
type ColorKey = (typeof COLOR_KEYS)[number];

const LABEL_MIN = 1;
const LABEL_MAX = 20;
const SORT_MIN = 0;
const SORT_MAX = 999;

const LEGEND_SELECT = "color_key, label, sort_order, is_active";

type LegendRow = {
  color_key: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};

/** 6 筆預設文案（reset 用；順序即前台顯示順序，10/20/30… 留空隙方便插隊） */
const DEFAULT_LEGEND: { color_key: ColorKey; label: string; sort_order: number }[] = [
  { color_key: "blue", label: "跑步", sort_order: 10 },
  { color_key: "green", label: "力量", sort_order: 20 },
  { color_key: "amber", label: "HYROX 專項", sort_order: 30 },
  { color_key: "teal", label: "技巧", sort_order: 40 },
  { color_key: "violet", label: "內部培訓", sort_order: 50 },
  { color_key: "orange", label: "戶外付費", sort_order: 60 },
];

/** 是否為 6 個合法色票鍵之一（含型別檢查） */
function isColorKey(value: unknown): value is ColorKey {
  return typeof value === "string" && (COLOR_KEYS as readonly string[]).includes(value);
}

/* =============================================================
 * GET：全部圖例（含停用，後台要能重新啟用）
 * ============================================================= */
export async function GET() {
  try {
    const auth = await authorizeAdmin();
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const { data, error } = await supabase
      .from("schedule_legend")
      .select(LEGEND_SELECT)
      .order("sort_order", { ascending: true })
      .order("color_key", { ascending: true });

    // 表還沒建（客戶尚未貼 migration）→ 500 SCHEMA_OUTDATED ＋可讀文案，
    // 不是裸 500，前台／後台才有辦法顯示「請先執行 migration」。
    if (error) {
      return jsonTrainingDbError("GET /api/admin/training/legend", error, MIGRATION);
    }

    const legend = ((data ?? []) as LegendRow[]).map((row) => ({
      color_key: row.color_key,
      label: row.label,
      sort_order: row.sort_order,
      is_active: row.is_active,
    }));

    return jsonOk({ legend, count: legend.length });
  } catch (err) {
    return jsonInternal("GET /api/admin/training/legend", err);
  }
}

/* =============================================================
 * POST：update / reset
 * ============================================================= */
export async function POST(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if ("res" in auth) return auth.res;
    const { supabase, userId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const action = text(body.action);
    if (action === "reset") return resetLegend(supabase, userId);
    if (action !== "update") {
      return jsonValidation(
        { action: "不支援的操作。" },
        "不支援的操作，action 必須是 update 或 reset。"
      );
    }

    /* ---------- 顏色：必須是固定 6 色之一 ---------- */
    const colorKey = body.color_key;
    if (!isColorKey(colorKey)) {
      return jsonValidation(
        { color_key: `顏色必須是 ${COLOR_KEYS.join("、")} 其中之一。` },
        "請檢查表單內容。"
      );
    }

    /* ---------- label：1–20 字（有給才驗，沒給代表不改） ---------- */
    let label: string | undefined;
    if (body.label !== undefined) {
      label = text(body.label);
      if (label.length < LABEL_MIN) {
        return jsonValidation({ label: "圖例文案不可空白。" }, "請檢查表單內容。");
      }
      if (label.length > LABEL_MAX) {
        return jsonValidation(
          { label: `圖例文案過長（上限 ${LABEL_MAX} 字）。` },
          "請檢查表單內容。"
        );
      }
    }

    /* ---------- sort_order：整數 0–999（不可靜默夾值，越界就回 400） ---------- */
    let sortOrder: number | undefined;
    if (body.sort_order !== undefined) {
      const n = Number(body.sort_order);
      if (!Number.isInteger(n) || n < SORT_MIN || n > SORT_MAX) {
        return jsonValidation(
          { sort_order: `排序需為 ${SORT_MIN} 到 ${SORT_MAX} 的整數。` },
          "請檢查表單內容。"
        );
      }
      sortOrder = n;
    }

    /* ---------- is_active：必須是布林 ---------- */
    let isActive: boolean | undefined;
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== "boolean") {
        return jsonValidation({ is_active: "啟用狀態必須是 true 或 false。" }, "請檢查表單內容。");
      }
      isActive = body.is_active;
    }

    if (label === undefined && sortOrder === undefined && isActive === undefined) {
      return jsonValidation(
        {},
        "沒有要修改的欄位，請提供 label、sort_order 或 is_active 其中之一。"
      );
    }

    /* ---------- 讀現有列：不存在的顏色不自動新增（避免出現畫不出來的圖例） ---------- */
    const { data: existingData, error: readError } = await supabase
      .from("schedule_legend")
      .select(LEGEND_SELECT)
      .eq("color_key", colorKey)
      .maybeSingle();

    if (readError) {
      return jsonTrainingDbError("POST /api/admin/training/legend read", readError, MIGRATION);
    }
    if (!existingData) {
      return jsonNotFound("找不到這個顏色的圖例資料，請用「還原預設」重新建立六筆。");
    }

    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (label !== undefined) payload.label = label;
    if (sortOrder !== undefined) payload.sort_order = sortOrder;
    if (isActive !== undefined) payload.is_active = isActive;

    const { data: savedData, error: writeError } = await supabase
      .from("schedule_legend")
      .update(payload)
      .eq("color_key", colorKey)
      .select(LEGEND_SELECT)
      .maybeSingle();

    if (writeError) {
      return jsonTrainingDbError("POST /api/admin/training/legend update", writeError, MIGRATION);
    }
    if (!savedData) {
      // RLS 擋掉（非管理員）或列在讀取後被刪 —— 兩者都回 404，不洩漏內部原因。
      return jsonNotFound("找不到這個顏色的圖例資料，請用「還原預設」重新建立六筆。");
    }

    const saved = savedData as LegendRow;

    revalidateTrainingSchedule();
    await writeAuditLog(
      supabase,
      userId,
      "training",
      "legend-update",
      `更新班表顏色圖例 ${saved.color_key} → 文案「${saved.label}」／排序 ${saved.sort_order}／${
        saved.is_active ? "顯示" : "隱藏"
      }`
    );

    return jsonOk({
      message: `已更新「${saved.label}」的圖例設定。`,
      legend: {
        color_key: saved.color_key,
        label: saved.label,
        sort_order: saved.sort_order,
        is_active: saved.is_active,
      },
    });
  } catch (err) {
    return jsonInternal("POST /api/admin/training/legend", err);
  }
}

/**
 * 還原 6 筆預設文案。
 *
 * 用 upsert 而不是 update：客戶若不小心把某列刪掉（或 migration 的種子曾中斷），
 * reset 也能把它補回來並恢復 is_active。
 */
async function resetLegend(supabase: Supabase, userId: string): Promise<Response> {
  const nowIso = new Date().toISOString();
  const payload = DEFAULT_LEGEND.map((row) => ({
    ...row,
    is_active: true,
    updated_at: nowIso,
  }));

  const { data, error } = await supabase
    .from("schedule_legend")
    .upsert(payload, { onConflict: "color_key" })
    .select(LEGEND_SELECT);

  if (error) {
    return jsonTrainingDbError("POST /api/admin/training/legend reset", error, MIGRATION);
  }

  const legend = ((data ?? []) as LegendRow[])
    .map((row) => ({
      color_key: row.color_key,
      label: row.label,
      sort_order: row.sort_order,
      is_active: row.is_active,
    }))
    .sort((a, b) => a.sort_order - b.sort_order || a.color_key.localeCompare(b.color_key));

  revalidateTrainingSchedule();
  await writeAuditLog(
    supabase,
    userId,
    "training",
    "legend-update",
    "重置班表顏色圖例為預設文案（6 筆）"
  );

  return jsonOk({ message: "已還原六筆預設圖例文案。", legend, count: legend.length });
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
