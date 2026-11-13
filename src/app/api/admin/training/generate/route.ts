/**
 * POST /api/admin/training/generate — { year, month }
 *
 * 呼叫 Postgres RPC public.generate_month(p_year, p_month)，
 * 依 training_rules 的週期規則把該月場次落地到 training_sessions。
 *
 * 權限：authorizeAdmin()（未設定 400 / 未登入 401 / 非管理員 403）
 * 另外 RPC 內部還有一道 is_admin() / service_role 檢查（縱深防禦）。
 *
 * 回傳（成功）：{ ok:true, year, month, created, skipped, from, to }
 * 回傳（RPC 拒絕）：依 code 對映 403 / 400。
 * 重複生成是安全的：on conflict (class_id, session_date, start_time) do nothing，
 * 已存在的場次（含管理員取消的 cancelled）不會被覆蓋或復活，skipped 會計入。
 *
 * Owner：白客（backend-engineer）
 */

import { writeAuditLog } from "@/lib/audit";
import {
  jsonBadJson,
  jsonForbidden,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";
import {
  authorizeAdmin,
  isIntInRange,
  jsonTrainingDbError,
  revalidateTrainingSchedule,
  text,
} from "../_shared";

/** generate_month 的回傳（jsonb） */
type GenerateResult = {
  ok?: boolean;
  code?: string;
  message?: string;
  created?: number;
  skipped?: number;
  from?: string;
  to?: string;
};

function asResult(data: unknown): GenerateResult {
  return typeof data === "object" && data !== null ? (data as GenerateResult) : {};
}

export async function POST(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if ("res" in auth) return auth.res;
    const { supabase, userId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    // year / month 必須是整數且在範圍內：0、-1、99999、"abc"、null 全部擋掉
    const year = Number(body.year);
    if (!isIntInRange(year, 2024, 2100)) {
      return jsonValidation(
        { year: "年份需介於 2024 與 2100 之間。" },
        "請選擇要生成的正確年月。"
      );
    }

    const month = Number(body.month);
    if (!isIntInRange(month, 1, 12)) {
      return jsonValidation({ month: "月份需介於 1 與 12 之間。" }, "請選擇要生成的正確年月。");
    }

    const { data, error } = await supabase.rpc("generate_month", {
      p_year: year,
      p_month: month,
    });

    if (error) {
      // 函式或資料表還沒建（客戶尚未貼上 migration）→ jsonTrainingDbError 會回
      // 500 SCHEMA_OUTDATED 並附上 migration 檔名；其餘錯誤走統一對映。
      return jsonTrainingDbError("POST /api/admin/training/generate rpc", error);
    }

    const result = asResult(data);

    if (result.ok !== true) {
      const code = text(result.code);
      const message = text(result.message);

      if (code === "NOT_ADMIN") return jsonForbidden();
      if (code === "INVALID_ARGS" || code === "INVALID_RANGE" || code === "RANGE_TOO_LARGE") {
        return jsonValidation({}, message || "參數不合法。");
      }
      return jsonInternal("POST /api/admin/training/generate 未預期結果", result);
    }

    const created = typeof result.created === "number" ? result.created : 0;
    const skipped = typeof result.skipped === "number" ? result.skipped : 0;

    revalidateTrainingSchedule();
    await writeAuditLog(
      supabase,
      userId,
      "training",
      "generate",
      `生成 ${year} 年 ${month} 月班表：新增 ${created} 場、略過 ${skipped} 場`
    );

    return jsonOk({
      message: `已生成 ${year} 年 ${month} 月班表：新增 ${created} 場、略過 ${skipped} 場。`,
      year,
      month,
      created,
      skipped,
      from: result.from ?? null,
      to: result.to ?? null,
    });
  } catch (err) {
    return jsonInternal("POST /api/admin/training/generate", err);
  }
}

/** 未實作的 HTTP 方法一律回 JSON（H6） */
export async function GET() {
  return jsonMethodNotAllowed();
}

export async function PUT() {
  return jsonMethodNotAllowed();
}

export async function DELETE() {
  return jsonMethodNotAllowed();
}
