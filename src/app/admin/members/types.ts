/**
 * src/app/admin/members/types.ts — 會員管理資料型別
 *
 * 契約來源：GET /api/admin/members?q=&role=&status=&page=&limit=
 *   → { ok:true, data:{ members, total, page, limit, has_service_role } }
 *   GET /api/admin/members/[id] → { ok:true, data:{ member, counts, recent_runs, recent_checkins } }
 *
 * recent_runs / recent_checkins 的單筆欄位由後端決定，這裡只把「確定會用到」的
 * 欄位標成 optional，其餘用索引簽章接住；畫面一律透過 MemberDrawer 內的
 * pickText / pickNumber 做防禦性取值，欄位對不上時顯示「—」而不是爆錯。
 */

export type MemberRole = "member" | "admin";
export type MemberStatus = "active" | "suspended" | "disabled";

export interface MemberRow {
  member_id: string;
  display_name: string | null;
  email: string | null;
  role: MemberRole;
  status: MemberStatus;
  status_reason: string | null;
  points: number;
  total_km: number | string;
  created_at: string;
  last_sign_in_at: string | null;
  run_count: number | string;
  checkin_count: number | string;
  coupon_count: number | string;
}

/** 詳情端點的 member 可能多帶電話（列表端點沒有） */
export interface MemberDetailMember extends MemberRow {
  phone?: string | null;
}

export interface MemberCounts {
  run_count?: number | string | null;
  checkin_count?: number | string | null;
  coupon_count?: number | string | null;
  [key: string]: number | string | null | undefined;
}

export interface RecentRun {
  id?: string | number | null;
  created_at?: string | null;
  submitted_at?: string | null;
  run_date?: string | null;
  distance_km?: number | string | null;
  status?: string | null;
  [key: string]: unknown;
}

export interface RecentCheckin {
  id?: string | number | null;
  created_at?: string | null;
  checkin_at?: string | null;
  session_date?: string | null;
  title?: string | null;
  checkin_type?: string | null;
  [key: string]: unknown;
}

export interface MemberDetail {
  member: MemberDetailMember;
  counts: MemberCounts;
  recent_runs: RecentRun[];
  recent_checkins: RecentCheckin[];
}

export interface MemberListData {
  members: MemberRow[];
  total: number;
  page: number;
  limit: number;
  has_service_role: boolean;
}

/** 錯誤信封：{ ok:false, error, code?, fields? } */
export interface ApiErrorEnvelope {
  ok: false;
  error: string;
  code?: string;
  fields?: Record<string, string>;
}

export function isOkEnvelope<T>(body: unknown): body is { ok: true; data: T } {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { ok?: unknown }).ok === true
  );
}

export function parseError(
  body: unknown,
  fallback: string
): { error: string; code?: string; fields?: Record<string, string> } {
  if (typeof body === "object" && body !== null) {
    const raw = body as { ok?: unknown; error?: unknown; code?: unknown; fields?: unknown };
    if (raw.ok === false) {
      const fields: Record<string, string> = {};
      if (typeof raw.fields === "object" && raw.fields !== null) {
        for (const [key, value] of Object.entries(raw.fields as Record<string, unknown>)) {
          if (typeof value === "string" && value) fields[key] = value;
        }
      }
      return {
        error: typeof raw.error === "string" && raw.error ? raw.error : fallback,
        code: typeof raw.code === "string" ? raw.code : undefined,
        fields: Object.keys(fields).length > 0 ? fields : undefined,
      };
    }
  }
  return { error: fallback };
}
