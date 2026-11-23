/**
 * /api/admin/races/registrations/[id] — 管理員審核單筆賽事報名（管理員限定）
 *
 * PATCH { status?, payment_status?, admin_note? }
 *   → 200 { ok:true, registration:{…} }
 *
 * 契約要點：
 *   · 三個欄位都可選，但至少要有一個（否則 400：不做空更新）。
 *   · status ∈ submitted / confirmed / needs_info / cancelled
 *     payment_status ∈ not_required / pending / approved / rejected
 *     admin_note ≤1000 字（空字串 → null）
 *   · 只有管理員走得到這裡，這是唯一能把 status 改成 confirmed、
 *     把 payment_status 改成 approved 的入口（會員端 RLS 的 with check
 *     只允許 submitted/cancelled，付款狀態另有觸發器強制覆寫）。
 *
 * 【四個必查安全項】
 *   · 越權：authorizeAdmin()。
 *   · IDOR：id 先驗 uuid；查回該筆報名後再 loadRace() 確認它屬於一場賽事
 *           （series='race'），避免拿別的模組的報名 id 改到 HYROX 的資料。
 *   · 參數：列舉逐值比對、admin_note 有長度上限。
 *   · 分頁：無。
 *
 * 【稽核】每次審核寫一筆 admin_audit_log（module="races"），摘要只放狀態與 id 前 8 碼，
 * 不放姓名電話。
 *
 * Owner：白客（backend-engineer）
 */

import { revalidateTag } from "next/cache"; import { authorizeModule } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { RACES_TAG } from "@/lib/races";
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
  NOTE_MAX,
  PAYMENT_STATUSES,
  RACE_NOT_FOUND_MSG,
  REG_STATUSES,
  REGISTRATION_NOT_FOUND_MSG,
  dbFail,
  loadRace,
} from "@/app/api/admin/races/_shared";

type Ctx = { params: Promise<{ id: string }> };

const REGISTRATION_COLUMNS =
  "id,event_id,user_id,full_name,phone,gender,needs_bus,bus_seats," +
  "needs_lodging,lodging_people,lodging_nights,payment_proof_path," +
  "payment_status,status,member_note,admin_note,created_at,updated_at";

function cpLength(s: string): number {
  return Array.from(s).length;
}

export function GET() {
  return jsonMethodNotAllowed();
}

export function POST() {
  return jsonMethodNotAllowed();
}

export function DELETE() {
  return jsonMethodNotAllowed();
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const auth = await authorizeModule("events", { write: true });
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    const { id } = await ctx.params;
    const registrationId = (id ?? "").trim();
    if (!isUuid(registrationId)) return jsonValidation({ id: "報名編號格式錯誤。" });

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const fields: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

    if (has("status")) {
      const raw = body.status;
      if (typeof raw !== "string" || !(REG_STATUSES as readonly string[]).includes(raw)) {
        fields.status = `報名狀態只接受 ${REG_STATUSES.join("／")}。`;
      } else {
        values.status = raw;
      }
    }

    if (has("payment_status")) {
      const raw = body.payment_status;
      if (typeof raw !== "string" || !(PAYMENT_STATUSES as readonly string[]).includes(raw)) {
        fields.payment_status = `付款狀態只接受 ${PAYMENT_STATUSES.join("／")}。`;
      } else {
        values.payment_status = raw;
      }
    }

    if (has("admin_note")) {
      const raw = body.admin_note;
      if (raw === null || raw === undefined) {
        values.admin_note = null;
      } else if (typeof raw !== "string") {
        fields.admin_note = "備註格式錯誤。";
      } else if (raw.trim() === "") {
        values.admin_note = null;
      } else if (cpLength(raw.trim()) > NOTE_MAX) {
        fields.admin_note = `備註最多 ${NOTE_MAX} 個字。`;
      } else {
        values.admin_note = raw.trim();
      }
    }

    if (Object.keys(fields).length > 0) return jsonValidation(fields);
    if (Object.keys(values).length === 0) {
      return jsonValidation({}, "沒有可更新的欄位。");
    }

    /* ── 存在性 + IDOR：這筆報名必須屬於一場賽事 ────────────── */
    const { data: current, error: readErr } = await supabase
      .from("race_registrations")
      .select("id,event_id,status,payment_status")
      .eq("id", registrationId)
      .maybeSingle();

    if (readErr) return dbFail("PATCH /api/admin/races/registrations/[id] read", readErr);
    if (!current) return jsonNotFound(REGISTRATION_NOT_FOUND_MSG);

    const currentRow = current as unknown as { id: string; event_id: string };

    const { row: event, error: guardErr } = await loadRace(supabase, currentRow.event_id);
    if (guardErr) return dbFail("PATCH /api/admin/races/registrations/[id] guard", guardErr);
    if (!event) return jsonNotFound(RACE_NOT_FOUND_MSG);

    const { data, error } = await supabase
      .from("race_registrations")
      .update(values)
      .eq("id", registrationId)
      .eq("event_id", currentRow.event_id)
      .select(REGISTRATION_COLUMNS)
      .maybeSingle();

    if (error) return dbFail("PATCH /api/admin/races/registrations/[id] update", error);
    if (!data) return jsonNotFound(REGISTRATION_NOT_FOUND_MSG);

    revalidateTag(RACES_TAG, { expire: 60 });

    // 摘要只放狀態與 id 前 8 碼：稽核要看得出「改了什麼」，但不留個資
    await writeAuditLog(
      supabase,
      actorId,
      "races",
      "registration-review",
      `審核賽事報名 ${registrationId.slice(0, 8)}（` +
        `status=${String(values.status ?? "不變")}, payment=${String(values.payment_status ?? "不變")}）`
    );

    return jsonOk({ registration: data });
  } catch (err) {
    return jsonInternal("PATCH /api/admin/races/registrations/[id]", err);
  }
}
