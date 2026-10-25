/**
 * /api/admin/event-registrations — 活動站內報名取數（管理員限定；T-26）
 *
 * GET                                 全部活動的站內報名人數（活動管理每張卡用）
 * GET ?event_id=uuid                  某一場活動的報名名單（會員暱稱 + 報名時間）
 *
 * 【契約（交付方砚的完整規格）】
 * 入參：
 *   event_id  選填；uuid 格式，不合法 → 400（fields.event_id）
 *   其餘 query 一律忽略（不支援分頁參數：固定上限見下）
 *
 * 回傳（不帶 event_id）：
 *   {
 *     "ok": true,
 *     "events": [                        ↑ 全部活動（含 0 人報名），依 event_date 降序
 *       { "event_id": "uuid", "title": "…", "event_date": "2026-11-01",
 *         "status": "published", "registered": 3 }
 *     ],
 *     "total_registered": 5,             ↑ 全部活動的站內報名總列數
 *     "truncated": false                 ↑ 報名掃描達到 2000 列上限時為 true（counts 為下限）
 *   }
 *   上限：events 取 200 場（與 getAdminEvents 同）；報名列掃描 2000 列
 *   （只取 event_id 一欄，量級為數百會員時遠低於上限；truncated 如實標記）。
 *
 * 回傳（帶 event_id）：
 *   {
 *     "ok": true,
 *     "event": { "event_id": "uuid", "title": "…", "event_date": "2026-11-01",
 *                "status": "published", "registered": 3 },
 *     "registrations": [                 ↑ 依 created_at 升序（先報名先顯示），上限 200 人
 *       { "id": "uuid", "user_id": "uuid", "display_name": "阿健",
 *         "created_at": "2026-10-23T04:00:00+00:00" }
 *     ]
 *   }
 *   event_id 不存在 → 404；暱稱為 null 的會員顯示「匿名會員」（與排行榜同口径）。
 *
 * 口徑：registered 只數 status='registered' 的列（會員取消 = DELETE 該列，
 * 故即「目前報名人數」）。儀表板（analytics_event_registrations RPC）與本端點
 * 同源，數字應一致（D5 驗收點）。
 *
 * 授權：H4 复刻 site-content（未登入 401 / 非管理員 403）。
 * Owner：白客
 *
 * H6：全部包 try/catch，任何情況都回 JSON。
 */

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isUuid,
  jsonForbidden,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotConfigured,
  jsonNotFound,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
} from "@/lib/api";

/** 與 getAdminEvents 同級的活動讀取上限 */
const MAX_EVENTS = 200;
/** 報名掃描上限（只取 event_id 一欄；超出時 truncated=true，counts 為下限） */
const MAX_REGISTRATION_SCAN = 2000;
/** 單場活動名單上限 */
const MAX_ROSTER = 200;

/** H4：Supabase 設定檢查 → 未登入 401 → 非管理員 403（复刻 site-content） */
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

  return { supabase } as const;
}

type Authorized = Awaited<ReturnType<typeof authorizeAdmin>>;

type Supabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;

/* =============================================================
 * GET — 全部活動 counts 或單場活動名單
 * ============================================================= */
export async function GET(request: Request) {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const url = new URL(request.url);
    const eventId = (url.searchParams.get("event_id") ?? "").trim();

    if (eventId) return roster(supabase, eventId);
    return allCounts(supabase);
  } catch (err) {
    return jsonInternal("GET /api/admin/event-registrations", err);
  }
}

/** 不帶 event_id：全部活動的站內報名人數 */
async function allCounts(supabase: Supabase) {
  // 1) 活動清單（與 getAdminEvents 同口径：全狀態、依日期降序、上限 200）
  const { data: events, error: evErr } = await supabase
    .from("events")
    .select("id, title, event_date, status")
    .order("event_date", { ascending: false })
    .limit(MAX_EVENTS);
  if (evErr) return jsonInternal("GET /api/admin/event-registrations events", evErr);

  // 2) 報名列（只取 event_id 一欄；RLS：管理員可見全部）
  //    如實註記：不用 PostgREST 内嵌 count——filter + count 的行為在無法連線
  //    實測的沙箱裡屬未驗證路徑；兩次有界查詢 + 内存點數是完全可推導的行為。
  const { data: regs, error: regErr } = await supabase
    .from("event_registrations")
    .select("event_id")
    .eq("status", "registered")
    .limit(MAX_REGISTRATION_SCAN);
  if (regErr) return jsonInternal("GET /api/admin/event-registrations counts", regErr);

  const rows = (regs ?? []) as { event_id: string }[];
  const tally = new Map<string, number>();
  for (const r of rows) tally.set(r.event_id, (tally.get(r.event_id) ?? 0) + 1);

  const eventsOut = ((events ?? []) as {
    id: string;
    title: string;
    event_date: string;
    status: string;
  }[]).map((e) => ({
    event_id: e.id,
    title: e.title,
    event_date: e.event_date,
    status: e.status,
    registered: tally.get(e.id) ?? 0,
  }));

  return jsonOk({
    events: eventsOut,
    total_registered: rows.length,
    truncated: rows.length >= MAX_REGISTRATION_SCAN,
  });
}

/** 帶 event_id：單場活動的報名名單（會員暱稱 + 報名時間） */
async function roster(supabase: Supabase, eventId: string) {
  if (!isUuid(eventId)) return jsonValidation({ event_id: "編號格式錯誤。" });

  // 1) 活動本體（不存在 → 404）
  const { data: event } = await supabase
    .from("events")
    .select("id, title, event_date, status")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return jsonNotFound("找不到這筆活動。");

  // 2) 名單。註：event_registrations 只有一條 FK 指向 profiles（user_id），
  //    不像 run_submissions／training_checkins 有雙 FK，故不需 !約束名 hint。
  const { data: regs, error } = await supabase
    .from("event_registrations")
    .select("id, user_id, created_at, profile:profiles(id, display_name)")
    .eq("event_id", eventId)
    .eq("status", "registered")
    .order("created_at", { ascending: true })
    .limit(MAX_ROSTER);
  if (error) return jsonInternal("GET /api/admin/event-registrations roster", error);

  const rows = (regs ?? []) as unknown as {
    id: string;
    user_id: string;
    created_at: string;
    profile: { id: string; display_name: string | null } | null;
  }[];

  const registrations = rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    display_name: r.profile?.display_name ?? "匿名會員",
    created_at: r.created_at,
  }));

  return jsonOk({
    event: {
      event_id: event.id,
      title: event.title,
      event_date: event.event_date,
      status: event.status,
      registered: registrations.length,
    },
    registrations,
  });
}

/** H6：未實作的方法也回 JSON 405（本端點為唯讀） */
export async function POST() {
  return jsonMethodNotAllowed();
}
export async function DELETE() {
  return jsonMethodNotAllowed();
}
export async function PUT() {
  return jsonMethodNotAllowed();
}
export async function PATCH() {
  return jsonMethodNotAllowed();
}
