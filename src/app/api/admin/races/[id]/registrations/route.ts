/**
 * /api/admin/races/[id]/registrations — 賽事報名名單 + 彙總（管理員限定）
 *
 * GET ?page=1&size=50&status=submitted
 *   → 200 {
 *       ok:true,
 *       event:{ id, title, start_date, end_date },
 *       page, size, total,
 *       summary:{ registrations, entries, bus_seats, lodging_people, lodging_nights,
 *                 by_status:{…}, by_payment:{…} },
 *       summary_source:"view" | "computed",
 *       registrations:[{ …報名列, proof_url, entries:[{ id, category_id, category_name, day, teammate_names }] }]
 *     }
 *
 * 【這是全站唯一會出現姓名的賽事端點】
 * 姓名／電話只在這裡回給已授權的管理員；server log 一律不印個資。
 * 公開頁只能讀 migration-races.sql §4 的四個聚合檢視（不含任何姓名）。
 *
 * 【四個必查安全項】
 *   · 越權：authorizeAdmin()（未設定 400／未登入 401／非管理員 403）。RLS 另有
 *           race_registrations_select_own_or_admin 做第二道。
 *   · IDOR：id 先驗 uuid，再 loadRace() 確認是 series='race' 的賽事；
 *           不存在或屬於別的系列一律 404（不揭露別的模組的 id）。
 *   · 參數：page ≥ 1；size 1–200（預設 50）；status 只接受四個列舉值。
 *           page=0 / page=-1 / size=0 / size=99999 一律 400 且有可讀訊息，
 *           不會全量返回、也不會 500。
 *   · 分頁：強制 .range()，單次最多 200 列。
 *
 * 【付款截圖】私有桶 run-screenshots → createSignedUrls 一次簽一批（1 小時）；
 * 簽名失敗只降級成 null，不讓整個名單 500。
 *
 * 【降級】race_summary 檢視還沒建時，改用有上限（5000 列）的彙總計算，
 * 並在回應標明 summary_source="computed"，管理員看得出數字是怎麼來的。
 *
 * Owner：白客（backend-engineer）
 */

import { authorizeAdmin } from "@/lib/admin-guard";
import {
  isUuid,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
} from "@/lib/api";
import {
  PAGE_MIN,
  PAYMENT_STATUSES,
  PROOF_BUCKET,
  PROOF_URL_TTL,
  RACE_NOT_FOUND_MSG,
  REG_STATUSES,
  SIZE_DEFAULT,
  SIZE_MAX,
  SIZE_MIN,
  dbFail,
  isSchemaMissing,
  loadRace,
  parseIntParam,
} from "@/app/api/admin/races/_shared";

type Ctx = { params: Promise<{ id: string }> };

/** 資料庫原始列（含關聯的 race_entries / race_categories） */
type RawRegistration = {
  id: string;
  event_id: string;
  user_id: string;
  full_name: string;
  phone: string;
  gender: "male" | "female" | null;
  needs_bus: boolean;
  bus_seats: number;
  needs_lodging: boolean;
  lodging_people: number;
  lodging_nights: number;
  payment_proof_path: string | null;
  payment_status: string;
  status: string;
  member_note: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
};

type RawEntry = {
  id: string;
  registration_id: string;
  category_id: string;
  teammate_names: string | null;
};

type RawCategory = {
  id: string;
  name: string;
  day: string;
};

const REGISTRATION_COLUMNS =
  "id,event_id,user_id,full_name,phone,gender,needs_bus,bus_seats," +
  "needs_lodging,lodging_people,lodging_nights,payment_proof_path," +
  "payment_status,status,member_note,admin_note,created_at,updated_at";

/** 明細一次最多抓幾筆人次（200 人 × 每人最多 8 組 = 1600，留餘裕） */
const ENTRY_LIMIT = 2000;
/** 降級彙總最多掃幾列（超過只會低估，回應會標明 summary_source="computed"） */
const FALLBACK_SCAN_LIMIT = 5000;

export function POST() {
  return jsonMethodNotAllowed();
}

export function PATCH() {
  return jsonMethodNotAllowed();
}

export function DELETE() {
  return jsonMethodNotAllowed();
}

export async function GET(request: Request, ctx: Ctx) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    const { id } = await ctx.params;
    const eventId = (id ?? "").trim();
    if (!isUuid(eventId)) return jsonValidation({ id: "賽事編號格式錯誤。" });

    /* ── 分頁邊界（測試一定會打這幾個值）──────────────────────── */
    const params = new URL(request.url).searchParams;

    const page = parseIntParam(params.get("page"), 1);
    if (page === null || page < PAGE_MIN) {
      return jsonValidation({ page: "頁碼必須是 1 以上的整數。" });
    }

    const size = parseIntParam(params.get("size"), SIZE_DEFAULT);
    if (size === null || size < SIZE_MIN || size > SIZE_MAX) {
      return jsonValidation({ size: `每頁筆數必須介於 ${SIZE_MIN} 到 ${SIZE_MAX}。` });
    }

    const statusFilter = (params.get("status") ?? "").trim();
    if (statusFilter !== "" && !(REG_STATUSES as readonly string[]).includes(statusFilter)) {
      return jsonValidation({ status: `狀態只接受 ${REG_STATUSES.join("／")}。` });
    }

    /* ── IDOR 守門：必須是賽事 ───────────────────────────────── */
    const { row: event, error: guardErr } = await loadRace(supabase, eventId);
    if (guardErr) return dbFail("GET /api/admin/races/[id]/registrations guard", guardErr);
    if (!event) return jsonNotFound(RACE_NOT_FOUND_MSG);

    /* ── 名單主查詢（強制分頁）────────────────────────────────── */
    const from = (page - 1) * size;
    const to = from + size - 1;

    let listQuery = supabase
      .from("race_registrations")
      .select(REGISTRATION_COLUMNS, { count: "exact" })
      .eq("event_id", eventId);

    if (statusFilter !== "") listQuery = listQuery.eq("status", statusFilter);

    const { data: listData, error: listErr, count } = await listQuery
      .order("created_at", { ascending: true })
      .range(from, to);

    if (listErr) return dbFail("GET /api/admin/races/[id]/registrations list", listErr);

    const rows = (listData as unknown as RawRegistration[]) ?? [];
    const total = typeof count === "number" ? count : rows.length;

    /* ── 人次 + 組別（兩次批次查詢，不做 N+1）─────────────────── */
    const registrationIds = rows.map((r) => r.id);
    let entries: RawEntry[] = [];

    if (registrationIds.length > 0) {
      const { data: entryData, error: entryErr } = await supabase
        .from("race_entries")
        .select("id,registration_id,category_id,teammate_names")
        .in("registration_id", registrationIds)
        .limit(ENTRY_LIMIT);

      if (entryErr) return dbFail("GET /api/admin/races/[id]/registrations entries", entryErr);
      entries = (entryData as unknown as RawEntry[]) ?? [];
    }

    const categoryIds = Array.from(new Set(entries.map((e) => e.category_id)));
    const categoryMap = new Map<string, RawCategory>();

    if (categoryIds.length > 0) {
      const { data: catData, error: catErr } = await supabase
        .from("race_categories")
        .select("id,name,day")
        .in("id", categoryIds)
        .limit(ENTRY_LIMIT);

      if (catErr) return dbFail("GET /api/admin/races/[id]/registrations categories", catErr);
      for (const c of (catData as unknown as RawCategory[]) ?? []) categoryMap.set(c.id, c);
    }

    /* ── 付款截圖 signed URL（1 小時；失敗只降級成 null）───────── */
    const proofPaths = rows
      .map((r) => r.payment_proof_path)
      .filter((p): p is string => typeof p === "string" && p.length > 0);

    const proofUrlMap = new Map<string, string>();
    if (proofPaths.length > 0) {
      try {
        const { data: signed, error: signErr } = await supabase.storage
          .from(PROOF_BUCKET)
          .createSignedUrls(proofPaths, PROOF_URL_TTL);

        if (signErr) {
          console.warn("[api] 賽事付款截圖簽名失敗（降級為 null）：", signErr.message);
        } else {
          for (const item of signed ?? []) {
            if (item.path && item.signedUrl) proofUrlMap.set(item.path, item.signedUrl);
          }
        }
      } catch (signCatch) {
        console.warn("[api] 賽事付款截圖簽名例外（降級為 null）：", signCatch);
      }
    }

    /* ── 彙總：優先讀檢視，缺檢視時改算 ──────────────────────── */
    const { summary, summarySource } = await buildSummary(supabase, eventId);

    /* ── by_status / by_payment（各一次 head count，最多 8 次）── */
    const byStatus = await countBy(supabase, eventId, "status", REG_STATUSES);
    const byPayment = await countBy(supabase, eventId, "payment_status", PAYMENT_STATUSES);

    return jsonOk({
      event: {
        id: event.id,
        title: event.title,
        start_date: event.event_date,
        end_date: event.end_date,
      },
      page,
      size,
      total,
      summary: {
        ...summary,
        by_status: byStatus,
        by_payment: byPayment,
      },
      summary_source: summarySource,
      registrations: rows.map((r) => ({
        id: r.id,
        full_name: r.full_name,
        phone: r.phone,
        gender: r.gender ?? null,
        needs_bus: Boolean(r.needs_bus),
        bus_seats: Number(r.bus_seats ?? 0),
        needs_lodging: Boolean(r.needs_lodging),
        lodging_people: Number(r.lodging_people ?? 0),
        lodging_nights: Number(r.lodging_nights ?? 0),
        payment_status: r.payment_status,
        status: r.status,
        member_note: r.member_note ?? null,
        admin_note: r.admin_note ?? null,
        created_at: r.created_at,
        updated_at: r.updated_at,
        proof_url: r.payment_proof_path ? (proofUrlMap.get(r.payment_proof_path) ?? null) : null,
        entries: entries
          .filter((e) => e.registration_id === r.id)
          .map((e) => {
            const cat = categoryMap.get(e.category_id);
            return {
              id: e.id,
              category_id: e.category_id,
              category_name: cat?.name ?? null,
              day: cat?.day ?? null,
              teammate_names: e.teammate_names ?? null,
            };
          }),
      })),
    });
  } catch (err) {
    return jsonInternal("GET /api/admin/races/[id]/registrations", err);
  }
}

/* =============================================================
 * 內部：彙總
 * ============================================================= */

type SummaryNumbers = {
  registrations: number;
  entries: number;
  bus_seats: number;
  lodging_people: number;
  lodging_nights: number;
};

type AdminClient = Parameters<typeof loadRace>[0];

async function buildSummary(
  supabase: AdminClient,
  eventId: string
): Promise<{ summary: SummaryNumbers; summarySource: "view" | "computed" }> {
  const { data, error } = await supabase
    .from("race_summary")
    .select("event_id,registrations,entries,bus_seats,lodging_people,lodging_nights")
    .eq("event_id", eventId)
    .maybeSingle();

  if (!error && data) {
    const row = data as unknown as SummaryNumbers;
    return {
      summary: {
        registrations: Number(row.registrations ?? 0),
        entries: Number(row.entries ?? 0),
        bus_seats: Number(row.bus_seats ?? 0),
        lodging_people: Number(row.lodging_people ?? 0),
        lodging_nights: Number(row.lodging_nights ?? 0),
      },
      summarySource: "view",
    };
  }

  if (error && !isSchemaMissing(error)) {
    console.warn("[api] race_summary 讀取失敗（改用即時計算）：", error.message);
  }

  // 降級：檢視不存在 → 掃有上限的列數在 JS 加總（超過上限只會低估）
  const { data: raw, error: rawErr } = await supabase
    .from("race_registrations")
    .select("needs_bus,bus_seats,needs_lodging,lodging_people,lodging_nights")
    .eq("event_id", eventId)
    .neq("status", "cancelled")
    .limit(FALLBACK_SCAN_LIMIT);

  if (rawErr) {
    console.error("[api] 賽事彙總降級計算失敗：", rawErr.message);
  }

  let registrations = 0;
  let busSeats = 0;
  let lodgingPeople = 0;
  let lodgingNights = 0;
  for (const r of (raw as unknown as Array<Record<string, unknown>>) ?? []) {
    registrations += 1;
    if (r.needs_bus) busSeats += Number(r.bus_seats ?? 0);
    if (r.needs_lodging) {
      lodgingPeople += Number(r.lodging_people ?? 0);
      lodgingNights += Number(r.lodging_nights ?? 0);
    }
  }

  // 人次：用 inner join 過濾到本場賽事，直接讓 PostgREST 給 count
  const { count: entryCount, error: entryCountErr } = await supabase
    .from("race_entries")
    .select("id,race_registrations!inner(event_id,status)", { count: "exact", head: true })
    .eq("race_registrations.event_id", eventId)
    .neq("race_registrations.status", "cancelled");

  if (entryCountErr) {
    console.error("[api] 賽事人次計數失敗：", entryCountErr.message);
  }

  return {
    summary: {
      registrations,
      entries: typeof entryCount === "number" ? entryCount : 0,
      bus_seats: busSeats,
      lodging_people: lodgingPeople,
      lodging_nights: lodgingNights,
    },
    summarySource: "computed",
  };
}

/** 逐列舉值做 head count（回傳每個值的筆數；值一定齊全，缺的填 0） */
async function countBy(
  supabase: AdminClient,
  eventId: string,
  column: "status" | "payment_status",
  values: readonly string[]
): Promise<Record<string, number>> {
  const results = await Promise.all(
    values.map(async (value) => {
      const { count, error } = await supabase
        .from("race_registrations")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq(column, value);

      if (error) {
        console.warn(`[api] 賽事 ${column}=${value} 計數失敗：`, error.message);
        return [value, 0] as const;
      }
      return [value, typeof count === "number" ? count : 0] as const;
    })
  );

  const out: Record<string, number> = {};
  for (const value of values) out[value] = 0;
  for (const [value, n] of results) out[value] = n;
  return out;
}
