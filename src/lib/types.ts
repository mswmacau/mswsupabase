export type Role = "member" | "admin";
export type ReviewStatus = "pending" | "approved" | "rejected";
export type CouponStatus = "active" | "used" | "expired";

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
