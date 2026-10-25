/**
 * src/app/admin/analytics/page.tsx — 數據分析頁（T-24，Server Component 取數）
 *
 * Owner：方砚。對齊計劃 V2 §5.6（資訊架構）／§8.3（RPC 契約）。
 *
 * 取數模式照抄現有 admin 頁（如 src/app/admin/page.tsx）：以登入使用者嘅
 * session 呼叫 createClient()，一次 Promise.all 取齊八支分析函式與待審核筆數，
 * 同一份資料交俾 AnalyticsDashboard 渲染全部圖表與明細表（數字必然一致）。
 *
 * 權限：八支函式全部 security definer + is_admin 閡門（DB 側）；
 * 未登入／非管理員由 src/app/admin/layout.tsx 既有保護擋（對所有
 * /admin/* 生效，包含本頁）；本頁開頭另有 requireAdmin() 早退
 * （T-28 P3-3），非管理員不再觸發八支 RPC 白跑往返。
 *
 * 取數失敗（如網絡唔穩、分析功能未啟用）：不拋 500，改為全 null +
 * allFailed，由儀表板顯示錯誤與重試入口（H6 精神：錯誤要可讀、可重試）。
 *
 * T-25：頁面流量區支援 ?days=7 / 30 / 90 切換統計範圍（非法值回落 30），
 *       server 端以 analytics_page_stats(p_days) 重新取數。
 * T-26：新增第 8 支 RPC analytics_event_registrations（活動報名）。
 */

import { getAdminCounts } from "@/lib/queries";
import { createClient, requireAdmin } from "@/lib/supabase/server";
import { AnalyticsDashboard } from "./AnalyticsDashboard";
import type {
  ActivityOverviewData,
  AnalyticsPayload,
  BehaviorSegmentsData,
  CouponSummaryData,
  EventRegistrationsData,
  MemberGrowthData,
  PageStatsData,
  RunMonthlyData,
  SessionAttendanceData,
} from "./types";

export const metadata = { title: "數據分析" };
export const dynamic = "force-dynamic";

/** 取數月份範圍（與前台「近 12 個月」同口徑） */
const MONTHS = 12;
/** 場次明細列數上限（RPC p_limit 上限 100） */
const SESSION_LIMIT = 20;
/** 活動報名明細列數上限（RPC p_limit 上限 100） */
const EVENT_LIMIT = 20;
/** T-25：頁面流量統計天數選項（RPC p_days 上限 180 = 原始資料保留期） */
const PAGE_STATS_DAY_OPTIONS = [7, 30, 90] as const;
/** 預設統計天數（非法或缺少 ?days= 時使用） */
const PAGE_STATS_DAYS = 30;

/**
 * P3-1（T-28 驗收）：八支 RPC 的健壯形態是 jsonb 單列物件（migration 檔頭
 * 約定，空資料時鍵仍存在）。null／陣列／基本型別一律視為取數失敗，
 * 交給儀表板顯示錯誤牌，而不是讓渲染拋 TypeError 變 500。
 */
function isRpcRow(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  // P3-3（T-28 驗收）：頁級早退——非管理員（含未連接 Supabase，requireAdmin()
  // 同樣回 null）不再觸發八支分析 RPC，避免每次訪問白跑八次資料庫往返。
  // 早退方式照 src/app/admin/layout.tsx 的既有守衛：渲染行內保護頁（不重定向）；
  // getCurrentProfile 有 React cache 去重，與 layout 共用同一次請求的查詢。
  const admin = await requireAdmin();
  if (!admin) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
      >
        權限不足：數據分析只開放給管理員。
      </div>
    );
  }

  const { days: daysRaw } = await searchParams;
  const parsedDays = Number(daysRaw);
  const pageStatsDays: number =
    Number.isInteger(parsedDays) &&
    (PAGE_STATS_DAY_OPTIONS as readonly number[]).includes(parsedDays)
      ? parsedDays
      : PAGE_STATS_DAYS;

  const counts = await getAdminCounts();
  const pending = { runs: counts.pendingRuns, checkins: counts.pendingCheckins };

  let payload: AnalyticsPayload = {
    memberGrowth: null,
    activity: null,
    behavior: null,
    sessionAttendance: null,
    runMonthly: null,
    coupon: null,
    pageStats: null,
    eventRegistrations: null,
    pending,
    allFailed: true,
  };

  const supabase = await createClient();
  if (supabase) {
    try {
      const [growth, activity, behavior, attendance, run, coupon, page, eventRegs] =
        await Promise.all([
          supabase.rpc("analytics_member_growth", { p_months: MONTHS }),
          supabase.rpc("analytics_activity_overview"),
          supabase.rpc("analytics_behavior_segments"),
          supabase.rpc("analytics_session_attendance", { p_limit: SESSION_LIMIT }),
          supabase.rpc("analytics_run_monthly", { p_months: MONTHS }),
          supabase.rpc("analytics_coupon_summary"),
          supabase.rpc("analytics_page_stats", { p_days: pageStatsDays }),
          supabase.rpc("analytics_event_registrations", { p_limit: EVENT_LIMIT }),
        ]);

      payload = {
        memberGrowth:
          growth.error || !isRpcRow(growth.data)
            ? null
            : (growth.data as unknown as MemberGrowthData),
        activity:
          activity.error || !isRpcRow(activity.data)
            ? null
            : (activity.data as unknown as ActivityOverviewData),
        behavior:
          behavior.error || !isRpcRow(behavior.data)
            ? null
            : (behavior.data as unknown as BehaviorSegmentsData),
        sessionAttendance:
          attendance.error || !isRpcRow(attendance.data)
            ? null
            : (attendance.data as unknown as SessionAttendanceData),
        runMonthly:
          run.error || !isRpcRow(run.data)
            ? null
            : (run.data as unknown as RunMonthlyData),
        coupon:
          coupon.error || !isRpcRow(coupon.data)
            ? null
            : (coupon.data as unknown as CouponSummaryData),
        pageStats:
          page.error || !isRpcRow(page.data)
            ? null
            : (page.data as unknown as PageStatsData),
        eventRegistrations:
          eventRegs.error || !isRpcRow(eventRegs.data)
            ? null
            : (eventRegs.data as unknown as EventRegistrationsData),
        pending,
        allFailed: [
          growth,
          activity,
          behavior,
          attendance,
          run,
          coupon,
          page,
          eventRegs,
        ].every((r) => r.error !== null),
      };
    } catch {
      // 網絡層拋錯：保留全 null + allFailed，儀表板顯示可重試的錯誤牌
    }
  }

  return <AnalyticsDashboard data={payload} />;
}
