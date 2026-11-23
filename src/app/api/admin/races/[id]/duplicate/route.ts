/**
 * /api/admin/races/[id]/duplicate — 複製一場賽事（管理員限定）
 *
 * body：{ start_date: "YYYY-MM-DD"（必填）, end_date?: "YYYY-MM-DD" }
 * 回傳：201 { ok:true, event:{…}, categories:[…] }
 *
 * 【複製什麼、刻意不複製什麼】
 * 照搬：title（尾綴「（複製）」）、subtitle、body、start_time、end_time、location、
 *       capacity、registration_url、registration_note、fee_cents、cover_path、
 *       album_url、album_label、promo_note、logistics_note、sort_order，
 *       以及所有 categories（day 依「相對起始日」位移）。
 * 刻意清掉（安全考量，不是偷懶）：
 *   · status → 一律 'draft'：否則複製一場開放中的賽事會立刻開始收報名、
 *     而且如果它 promo_on_home，還會直接搶走主頁賽事帶。
 *   · promo_on_home → false：主頁帶同一時間只該有一場，由人決定。
 *   · registration_deadline → null：舊截止時間通常已過，照抄會讓新賽事
 *     「一建立就已經截止」，而且不會有任何錯誤訊息（最惡劣的靜默失敗）。
 * 管理員複製完，把 status 改成 'open'、補上截止時間即可上線。
 *
 * 【兩段寫入的補償】
 * events 插入成功、categories 插入失敗時，會把剛插入的 events 列刪掉再回錯誤，
 * 不留下「有賽事但沒有組別」的半套資料。
 *
 * 【四個必查安全項】
 *   · 越權：authorizeAdmin()。
 *   · IDOR：來源 id 先驗 uuid + loadRace() 確認是賽事。
 *   · 參數：start_date 必填且為合法 YYYY-MM-DD；end_date 選填；區間交叉檢查。
 *   · 分頁：無。
 *
 * Owner：白客（backend-engineer）
 */

import { revalidateTag } from "next/cache"; import { authorizeModule } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { RACES_TAG, RACE_SERIES } from "@/lib/races";
import {
  isUuid,
  jsonBadJson,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";
import {
  RACE_EVENT_COLUMNS,
  RACE_NOT_FOUND_MSG,
  TITLE_MAX,
  addDays,
  checkDateRange,
  dbFail,
  diffDays,
  isDateOnly,
  loadRace,
} from "@/app/api/admin/races/_shared";

export function GET() {
  return jsonMethodNotAllowed();
}

type Ctx = { params: Promise<{ id: string }> };

/** 來源賽事列（只列複製會用到的欄位） */
type SourceEvent = {
  id: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  event_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  capacity: number | null;
  registration_url: string | null;
  registration_note: string | null;
  cover_path: string | null;
  fee_cents: number | null;
  album_url: string | null;
  album_label: string | null;
  promo_note: string | null;
  logistics_note: string | null;
  sort_order: number | null;
  series: string | null;
};

type SourceCategory = {
  id: string;
  day: string;
  name: string;
  team_size: number;
  fee_cents: number;
  sort_order: number;
};

export async function POST(request: Request, ctx: Ctx) {
  try {
    const auth = await authorizeModule("events", { write: true });
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    const { id } = await ctx.params;
    const sourceId = (id ?? "").trim();
    if (!isUuid(sourceId)) return jsonValidation({ id: "賽事編號格式錯誤。" });

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    if (!isDateOnly(body.start_date)) {
      return jsonValidation({ start_date: "請提供新的開始日（YYYY-MM-DD）。" });
    }
    const newStart = body.start_date;

    if (body.end_date !== undefined && body.end_date !== null && body.end_date !== "") {
      if (!isDateOnly(body.end_date)) {
        return jsonValidation({ end_date: "結束日必須是 YYYY-MM-DD 格式的合法日期。" });
      }
    }

    // 來源賽事（IDOR 守門：必須是 series='race'）
    const { row: guard, error: guardErr } = await loadRace(supabase, sourceId);
    if (guardErr) return dbFail("POST /api/admin/races/[id]/duplicate guard", guardErr);
    if (!guard) return jsonNotFound(RACE_NOT_FOUND_MSG);

    const { data: sourceData, error: sourceErr } = await supabase
      .from("events")
      .select(RACE_EVENT_COLUMNS)
      .eq("id", sourceId)
      .eq("series", RACE_SERIES)
      .maybeSingle();

    if (sourceErr) return dbFail("POST /api/admin/races/[id]/duplicate source", sourceErr);
    if (!sourceData) return jsonNotFound(RACE_NOT_FOUND_MSG);

    const source = sourceData as unknown as SourceEvent;

    // 新日期：end_date 沒給就沿用「原本的賽事長度」
    let newEnd: string | null = null;
    if (isDateOnly(body.end_date)) {
      newEnd = body.end_date;
    } else if (source.end_date) {
      newEnd = addDays(newStart, diffDays(source.event_date, source.end_date));
    }

    const rangeErr = checkDateRange(newStart, newEnd);
    if (Object.keys(rangeErr).length > 0) return jsonValidation(rangeErr);

    // 標題尾綴，並確保不超過 DB 的 120 字上限
    const suffix = "（複製）";
    const baseTitle = source.title.slice(0, Math.max(1, TITLE_MAX - suffix.length));
    const newTitle = `${baseTitle}${suffix}`;

    const insertPayload: Record<string, unknown> = {
      title: newTitle,
      subtitle: source.subtitle,
      body: source.body,
      event_date: newStart,
      end_date: newEnd,
      start_time: source.start_time,
      end_time: source.end_time,
      location: source.location,
      capacity: source.capacity,
      registration_url: source.registration_url,
      registration_note: source.registration_note,
      cover_path: source.cover_path,
      fee_cents: source.fee_cents ?? 0,
      album_url: source.album_url,
      album_label: source.album_label,
      promo_note: source.promo_note,
      logistics_note: source.logistics_note,
      sort_order: source.sort_order ?? 0,
      series: RACE_SERIES,
      created_by: actorId,
      // 刻意不照搬（理由見檔頭）
      status: "draft",
      promo_on_home: false,
      registration_deadline: null,
    };

    const { data: createdData, error: createErr } = await supabase
      .from("events")
      .insert(insertPayload)
      .select(RACE_EVENT_COLUMNS)
      .single();

    if (createErr) return dbFail("POST /api/admin/races/[id]/duplicate insert", createErr);
    if (!createdData) return jsonInternal("duplicate insert returned no row");

    const newEventId = (createdData as unknown as { id: string }).id;

    // 複製組別：day 依「相對起始日的天數差」位移
    const { data: catData, error: catErr } = await supabase
      .from("race_categories")
      .select("id,day,name,team_size,fee_cents,sort_order")
      .eq("event_id", sourceId)
      .order("day", { ascending: true })
      .order("sort_order", { ascending: true })
      .limit(200);

    if (catErr) {
      await rollbackEvent(supabase, newEventId);
      return dbFail("POST /api/admin/races/[id]/duplicate categories read", catErr);
    }

    const sourceCategories = (catData as unknown as SourceCategory[]) ?? [];

    let newCategories: unknown[] = [];
    if (sourceCategories.length > 0) {
      const rows = sourceCategories.map((c) => ({
        event_id: newEventId,
        day: addDays(newStart, diffDays(source.event_date, c.day)),
        name: c.name,
        team_size: c.team_size,
        fee_cents: c.fee_cents,
        sort_order: c.sort_order,
      }));

      const { data: inserted, error: insertCatErr } = await supabase
        .from("race_categories")
        .insert(rows)
        .select("id,event_id,day,name,team_size,fee_cents,sort_order,created_at");

      if (insertCatErr) {
        await rollbackEvent(supabase, newEventId);
        return dbFail("POST /api/admin/races/[id]/duplicate categories insert", insertCatErr);
      }
      newCategories = inserted ?? [];
    }

    revalidateTag(RACES_TAG, { expire: 60 });
    await writeAuditLog(
      supabase,
      actorId,
      "races",
      "duplicate",
      `複製賽事「${source.title.slice(0, 30)}」→「${newTitle.slice(0, 30)}」`
    );

    return jsonOk({ event: createdData, categories: newCategories }, 201);
  } catch (err) {
    return jsonInternal("POST /api/admin/races/[id]/duplicate", err);
  }
}

/** 補償：把剛建立、但後續步驟失敗的賽事刪掉（失敗只寫 log，不影響回傳的錯誤） */
async function rollbackEvent(
  supabase: Parameters<typeof loadRace>[0],
  eventId: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from("events")
      .delete()
      .eq("id", eventId)
      .eq("series", RACE_SERIES);
    if (error) {
      console.error("[api] duplicate 補償刪除失敗（請人工清理 events 列）：", eventId, error.message);
    }
  } catch (err) {
    console.error("[api] duplicate 補償刪除例外（請人工清理 events 列）：", eventId, err);
  }
}
