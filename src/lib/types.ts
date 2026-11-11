export type Role = "member" | "admin";
export type ReviewStatus = "pending" | "approved" | "rejected";
export type CouponStatus = "active" | "used" | "expired";

/**
 * 性別（migration-paid-events-1.sql A 段 profiles.gender 的 check 值）。
 * DB 允許 null（既有會員尚未填），所以 Profile.gender 也是 optional。
 */
export type Gender = "male" | "female" | "undisclosed";

/**
 * 報名付款狀態（migration-paid-events-1.sql C 段）。
 * not_required 免費活動 / pending_review 待審 / confirmed 已通過 / rejected 已退回（可重交）
 */
export type PaymentStatus =
  | "not_required"
  | "pending_review"
  | "confirmed"
  | "rejected";

/** 活動的三態：draft 與 archived 都不出現在前台，只有 archived 不出現在後台預設列表 */
export type EventStatus = "draft" | "published" | "archived";

export interface Event {
  id: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  event_date: string; // YYYY-MM-DD
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  capacity: number | null;
  registration_url: string | null;
  registration_note: string | null;
  cover_path: string | null;
  status: EventStatus;
  /**
   * 活動分類（訓練 / 跑步 / 比賽 / 聚會）。
   * F-E2 階段一：只做 UI 準備。DB 尚未建立此欄位，故為 optional，
   * 現有 `.select("*")` 查詢唔使改、唔會影響既有資料。
   */
  category?: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  role: Role;
  points: number;
  total_km: number;
  created_at: string;
  /**
   * 實名資料（migration-paid-events-1.sql A 段新增）。
   * 全部 optional：DB 允許 null（既有會員未補資料），且仍有查詢是
   * `.select("id, display_name, avatar_url")` 這種部分欄位，標成 optional
   * 才不會逼那些地方一起改。前端要顯示時請用 `profile.full_name ?? ""`。
   */
  full_name?: string | null;
  gender?: Gender | null;
  /** 身分證件號後四位（只存後四位，用途：活動報名及保險登記） */
  id_last4?: string | null;
}

export interface TrainingSession {
  id: string;
  session_date: string;
  title: string;
  location: string;
  starts_at: string | null;
  ends_at: string | null;
  capacity: number;
  note: string | null;
  status: "open" | "closed" | "cancelled";
  created_at: string;
}

export interface TrainingCheckin {
  id: string;
  session_id: string;
  user_id: string;
  status: ReviewStatus;
  admin_note: string | null;
  confirmed_by: string | null;
  created_at: string;
  session?: TrainingSession;
  profile?: Pick<Profile, "id" | "display_name" | "avatar_url"> | null;
}

export interface RunSubmission {
  id: string;
  user_id: string;
  km: number;
  period_month: string;
  image_path: string;
  note: string | null;
  status: ReviewStatus;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  profile?: Pick<Profile, "id" | "display_name" | "avatar_url"> | null;
  image_url?: string | null;
}

export interface Coupon {
  id: string;
  code: string;
  user_id: string;
  title: string;
  description: string | null;
  month_awarded: string | null;
  status: CouponStatus;
  expires_at: string | null;
  redeemed_at: string | null;
  created_at: string;
}

export interface PointTransaction {
  id: string;
  user_id: string;
  delta: number;
  reason: string;
  ref_type: string | null;
  ref_id: string | null;
  created_at: string;
}

export interface MonthlyStat {
  user_id: string;
  period_month: string;
  total_km: number;
  runs: number;
}

export interface LeaderRow {
  user_id: string;
  name: string;
  total_km: number;
  runs: number;
  points: number;
}

export interface SiteStats {
  members: number;
  total_km: number;
  total_runs: number;
  total_sessions: number;
}
