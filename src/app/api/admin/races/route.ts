/**
 * /api/admin/races — 建立賽事（管理員限定）
 *
 * 方法：
 *   POST  建立一場賽事 → 201 { ok:true, event:{…} }
 *   其他  405 JSON（H6：不讓 Next 回空 body）
 *
 * 【寫入的欄位】
 * events 表，series 一律強制 'race'（不接受 body 指定，避免把一般活動改成賽事），
 * created_by 由伺服器填 auth.uid()（不信任 body），status 預設 'draft'。
 *
 * 【四個必查安全項】
 *   · 越權：authorizeAdmin()（未設定 400／未登入 401／非管理員 403）。
 *   · 參數：全部走 _shared.ts 的白名單解析（長度、上下界、列舉、日期合法性）；
 *           body 裡多餘的鍵一律忽略，不盲寫。
 *   · IDOR：本端點不讀任何既有資源，沒有 IDOR 面；建立後前端拿到新 id。
 *   · 分頁：本端點沒有分頁參數。
 *
 * 【降級】events 的 6 個新欄位還沒加時，PostgREST 回 PGRST204 / Postgres 42703
 * → _shared.dbFail() 轉成 400 SCHEMA_OUTDATED 並提示要跑的 SQL 檔，不是 500。
 *
 * Owner：白客（backend-engineer）
 */

import { revalidateTag } from "next/cache"; import { authorizeModule } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { RACES_TAG, RACE_SERIES } from "@/lib/races";
import {
  jsonBadJson,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";
import {
  RACE_EVENT_COLUMNS,
  dbFail,
  parseRaceFields,
} from "@/app/api/admin/races/_shared";

export function GET() {
  return jsonMethodNotAllowed();
}

export async function POST(request: Request) {
  try {
    const auth = await authorizeModule("events", { write: true });
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const parsed = parseRaceFields(body, "create");
    if (!parsed.ok) return jsonValidation(parsed.fields);

    const values: Record<string, unknown> = {
      ...parsed.values,
      series: RACE_SERIES,
      created_by: actorId,
    };
    // status 沒給就一定是草稿：新建的賽事不該預設就開始收報名
    if (typeof values.status !== "string") values.status = "draft";

    const { data, error } = await supabase
      .from("events")
      .insert(values)
      .select(RACE_EVENT_COLUMNS)
      .single();

    if (error) return dbFail("POST /api/admin/races insert", error);

    revalidateTag(RACES_TAG, { expire: 60 });
    await writeAuditLog(
      supabase,
      actorId,
      "races",
      "create",
      `建立賽事「${String(values.title ?? "").slice(0, 40)}」`
    );

    return jsonOk({ event: data }, 201);
  } catch (err) {
    return jsonInternal("POST /api/admin/races", err);
  }
}
