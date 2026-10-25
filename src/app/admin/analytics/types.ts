/**
 * src/app/admin/analytics/types.ts — 分析儀表板資料型別（T-24）
 *
 * Owner：方砚。逐鍵對齊 supabase/migration-analytics.sql 檔頭
 * 「分析 RPC 回傳結構總覽」（白客 T-23 定稿）——儀表板嚴格照它渲染，
 * 此處只作 TypeScript 鏡像，不改變任何口徑。
 *
 * 約定（見 migration 檔頭）：任何鍵在空資料時仍存在（空陣列／0），
 * 不會回傳 null、不會省略鍵；此處的 `| null` 表示「整支 RPC 取數失敗」，
 * 由儀表板顯示「暫時讀不到」，與「空數據」是兩種不同狀態。
 */

/** A1 會員增長：每月新註冊數 + 累計會員數 */
export interface GrowthMonth {
  month: string; // 'YYYY-MM'（澳門時間）
  new_members: number;
  cumulative_members: number;
}

export interface MemberGrowthData {
  months: GrowthMonth[];
  total_members: number;
}

/** A2 會員活躍度 */
export interface ActivityOverviewData {
  total_members: number;
  active_30d: number;
  active_90d: number;
  active_rate_30d: number; // 0–1，四位小數
  active_rate_90d: number;
  silent_90d: number;
}

/** A3 行為畫像 + A4 月度達標率 */
export interface SegmentRow {
  label: string;
  count: number;
}

export interface GoalRateMonth {
  month: string;
  submitters: number; // 當月有已確認紀錄的人數
  qualified: number; // 其中達標人數
  rate: number; // qualified ÷ submitters（0–1）
}

export interface BehaviorSegmentsData {
  points_segments: SegmentRow[];
  km_segments: SegmentRow[];
  checkin_type_90d: number;
  run_type_90d: number;
  both_type_90d: number;
  monthly_goal_rate: GoalRateMonth[];
}

/** A5 訓練場次出席 */
export interface SessionAttendanceRow {
  session_id: string;
  session_date: string; // 'YYYY-MM-DD'
  title: string;
  status: string;
  capacity: number;
  registered: number; // 非 rejected 的報名列
  attended: number; // approved
  attendance_rate: number; // attended ÷ registered
  capacity_usage: number; // registered ÷ capacity
}

export interface SessionAttendanceData {
  sessions: SessionAttendanceRow[];
}

/** A6 跑步挑戰 */
export interface RunMonthRow {
  month: string;
  total_km: number;
  submissions: number;
  pending: number;
  approved: number;
  members: number;
  avg_km_per_member: number;
  qualified: number;
}

export interface RunMonthlyData {
  months: RunMonthRow[];
}

/** A7 優惠券 */
export interface CouponMonthlyRow {
  month: string;
  issued: number;
}

export interface CouponSummaryData {
  by_status: { active: number; used: number; expired: number };
  total: number;
  redeemed_rate: number; // used ÷ total（0–1）
  monthly: CouponMonthlyRow[];
}

/** D3/D4 頁面流量（估算值） */
export interface PagePathRow {
  path: string;
  views: number;
  sessions: number; // 該路徑的 distinct sid
  avg_dwell_ms: number;
}

export interface PageStatsData {
  days: number;
  total_views: number;
  total_sessions: number;
  avg_dwell_ms: number;
  paths: PagePathRow[];
}

/** D5 活動報名（T-26 第 8 支 RPC；只數站內報名） */
export interface EventRegistrationRow {
  event_id: string;
  event_date: string; // 'YYYY-MM-DD'
  title: string;
  status: string; // draft / published / archived
  registered: number; // status='registered' 的報名列數（會員取消 = DELETE 該列）
}

export interface EventRegistrationsData {
  events: EventRegistrationRow[];
}

/** 儀表板 payload：一次取數、同一份資料渲染全部圖表與明細表 */
export interface AnalyticsPayload {
  memberGrowth: MemberGrowthData | null;
  activity: ActivityOverviewData | null;
  behavior: BehaviorSegmentsData | null;
  sessionAttendance: SessionAttendanceData | null;
  runMonthly: RunMonthlyData | null;
  coupon: CouponSummaryData | null;
  pageStats: PageStatsData | null;
  eventRegistrations: EventRegistrationsData | null;
  /** 待審核筆數（後台總覽同源：跑步提交 + 訓練簽到） */
  pending: { runs: number; checkins: number } | null;
  /** 八支 RPC 全部失敗（如分析功能尚未啟用）→ 頂部顯示錯誤與重試 */
  allFailed: boolean;
}
