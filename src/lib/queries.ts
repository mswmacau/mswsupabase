import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient } from "./supabase/server";
import { anonClient } from "./supabase/anon";
import { coerceTheme, DEFAULT_THEME, type SiteTheme } from "./theme";
import { currentMonth, monthLabel, todayISO } from "./utils";
import type {
  Coupon,
  Event,
  LeaderRow,
  MonthlyStat,
  PointTransaction,
  Profile,
  RunSubmission,
  SiteStats,
  TrainingCheckin,
  TrainingSession,
} from "./types";

const EMPTY_STATS: SiteStats = {
  members: 0,
  total_km: 0,
  total_runs: 0,
  total_sessions: 0,
};

/** 全站統計（首頁數字） */
export async function getSiteStats(): Promise<SiteStats> {
  const supabase = await createClient();
  if (!supabase) return EMPTY_STATS;

  const { data, error } = await supabase.from("site_stats").select("*").maybeSingle();
  if (error || !data) return EMPTY_STATS;

  return {
    members: Number(data.members ?? 0),
    total_km: Number(data.total_km ?? 0),
    total_runs: Number(data.total_runs ?? 0),
    total_sessions: Number(data.total_sessions ?? 0),
  };
}

/** 即將到來的訓練場次 */
export async function getUpcomingSessions(limit = 4): Promise<TrainingSession[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("training_sessions")
    .select("*")
    .gte("session_date", today)
    .order("session_date", { ascending: true })
    .limit(limit);

  return (data as TrainingSession[]) ?? [];
}

/** 全部訓練場次（含歷史） */
export async function getAllSessions(limit = 60): Promise<TrainingSession[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("training_sessions")
    .select("*")
    .order("session_date", { ascending: false })
    .limit(limit);

  return (data as TrainingSession[]) ?? [];
}

/** getSiteTheme() 的 cache tag；revalidateTag 必須用同一個字串（see api/admin/site-settings） */
export const SITE_THEME_TAG = "site-theme";

/**
 * 網站主題（单次 columns read）
 *
 * Q2：用不含 cookie 的匿名客戶端 + unstable_cache（60 秒、tag `site-theme`），
 *     讓 root layout 與後台設定頁在同一請求內只打一次 DB。
 *     註：依 SPEC §8.2 R1 的事前決策，若 unstable_cache 在 Next 16.3 行為異常
 *     則退回 React.cache()（只做同請求去重），不得自創其他快取機制。
 */
export const getSiteTheme = unstable_cache(
  cache(async (): Promise<SiteTheme> => {
    const supabase = anonClient();
    if (!supabase) return DEFAULT_THEME;

    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "site_theme")
      .maybeSingle();

    if (error || !data) return DEFAULT_THEME;

    return coerceTheme(data.value);
  }),
  ["site-theme"],
  { tags: [SITE_THEME_TAG], revalidate: 60 }
);

/**
 * ── 前台公開查詢的快取版本 ──
 *
 * 首頁 / 活動 / 排行榜 / 訓練頁每次載入都會打 Supabase，但呢啲資料
 * 人人睇到嘅都一樣。用不含 cookie 的 anonClient + unstable_cache 包一層，
 * 60 秒內重複訪問唔使再打 DB，大幅縮短 TTFB。
 * （個人化查詢如 getCurrentProfile 照舊每次即時查；後台 admin/* 繼續用
 * 原本無快取嘅版本，確保審核睇到即時資料。）
 */

/** 全站統計（快取 120 秒，首頁用） */
export function getCachedSiteStats(): Promise<SiteStats> {
  return unstable_cache(
    cache(async (): Promise<SiteStats> => {
      const supabase = anonClient();
      if (!supabase) return EMPTY_STATS;
      const { data, error } = await supabase.from("site_stats").select("*").maybeSingle();
      if (error || !data) return EMPTY_STATS;
      return {
        members: Number(data.members ?? 0),
        total_km: Number(data.total_km ?? 0),
        total_runs: Number(data.total_runs ?? 0),
        total_sessions: Number(data.total_sessions ?? 0),
      };
    }),
    ["site-stats"],
    { revalidate: 120 }
  )();
}

/** 即將到來的訓練場次（快取 60 秒，首頁用） */
export function getCachedUpcomingSessions(limit = 4): Promise<TrainingSession[]> {
  return unstable_cache(
    cache(async (): Promise<TrainingSession[]> => {
      const supabase = anonClient();
      if (!supabase) return [];
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("training_sessions")
        .select("*")
        .gte("session_date", today)
        .order("session_date", { ascending: true })
        .limit(limit);
      return (data as TrainingSession[]) ?? [];
    }),
    ["upcoming-sessions", String(limit)],
    { revalidate: 60 }
  )();
}

/** 全部訓練場次（快取 60 秒，前台訓練頁用） */
export function getCachedAllSessions(limit = 60): Promise<TrainingSession[]> {
  return unstable_cache(
    cache(async (): Promise<TrainingSession[]> => {
      const supabase = anonClient();
      if (!supabase) return [];
      const { data } = await supabase
        .from("training_sessions")
        .select("*")
        .order("session_date", { ascending: false })
        .limit(limit);
      return (data as TrainingSession[]) ?? [];
    }),
    ["all-sessions", String(limit)],
    { revalidate: 60 }
  )();
}

/** 已上架活動（快取 60 秒，前台活動頁用） */
export function getCachedPublishedEvents(limit = 50): Promise<Event[]> {
  return unstable_cache(
    cache(async (): Promise<Event[]> => {
      const supabase = anonClient();
      if (!supabase) return [];
      const { data } = await supabase
        .from("events")
        .select("*")
        .eq("status", "published")
        .gte("event_date", todayISO())
        .order("event_date", { ascending: true })
        .order("sort_order", { ascending: false })
        .limit(limit);
      return (data as Event[]) ?? [];
    }),
    ["published-events", String(limit)],
    { revalidate: 60 }
  )();
}

/** 月度排行榜（快取 60 秒，首頁 + 排行榜頁用） */
export function getCachedMonthlyLeaderboard(
  month: string,
  limit = 10
): Promise<LeaderRow[]> {
  return unstable_cache(
    cache(async (): Promise<LeaderRow[]> => {
      const supabase = anonClient();
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("monthly_leaderboard")
        .select("user_id, period_month, total_km, runs, display_name, points")
        .eq("period_month", month)
        .order("total_km", { ascending: false })
        .limit(limit);
      if (error || !data?.length) return [];
      type LeaderboardRow = MonthlyStat & {
        display_name: string | null;
        points: number | null;
      };
      return (data as LeaderboardRow[]).map((d) => ({
        user_id: d.user_id,
        name: d.display_name ?? "匿名會員",
        total_km: Number(d.total_km),
        runs: Number(d.runs),
        points: Number(d.points ?? 0),
      }));
    }),
    ["monthly-leaderboard", month, String(limit)],
    { revalidate: 60 }
  )();
}

/** 總排行榜（快取 60 秒，排行榜頁用） */
export function getCachedAllTimeLeaderboard(limit = 20): Promise<LeaderRow[]> {
  return unstable_cache(
    cache(async (): Promise<LeaderRow[]> => {
      const supabase = anonClient();
      if (!supabase) return [];
      const { data } = await supabase
        .from("public_leaderboard")
        .select("id, display_name, avatar_url, points, total_km")
        .order("total_km", { ascending: false })
        .order("points", { ascending: false })
        .limit(limit);
      return ((data as Profile[]) ?? []).map((p) => ({
        user_id: p.id,
        name: p.display_name ?? "匿名會員",
        total_km: Number(p.total_km),
        runs: 0,
        points: p.points,
      }));
    }),
    ["all-time-leaderboard", String(limit)],
    { revalidate: 60 }
  )();
}

/** 前台：已上架且尚未過期的活動（單次查詢上限 50 筆，Q6） */
export async function getPublishedEvents(limit = 50): Promise<Event[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("events")
    .select("*")
    .eq("status", "published")
    .gte("event_date", todayISO())
    .order("event_date", { ascending: true })
    .order("sort_order", { ascending: false })
    .limit(limit);

  return (data as Event[]) ?? [];
}

/** 後台：全部活動（含 draft）；includeArchived=false 時排除已下架 */
export async function getAdminEvents(includeArchived = false): Promise<Event[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  let query = supabase
    .from("events")
    .select("*")
    .order("event_date", { ascending: false })
    .limit(200);

  if (!includeArchived) query = query.neq("status", "archived");

  const { data } = await query;
  return (data as Event[]) ?? [];
}

/** 月度排行榜（依當月已確認公里數） */
export async function getMonthlyLeaderboard(
  month: string = currentMonth(),
  limit = 10
): Promise<LeaderRow[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  // Q3：改用 monthly_leaderboard view（Schema R6 §3），一次拿到統計 + 暱稱 + 積分
  const { data, error } = await supabase
    .from("monthly_leaderboard")
    .select("user_id, period_month, total_km, runs, display_name, points")
    .eq("period_month", month)
    .order("total_km", { ascending: false })
    .limit(limit);

  if (error || !data?.length) return [];

  // monthly_leaderboard view 回傳「統計 + 暱稱 + 積分」，與既有 LeaderRow 完全一致（Q3）
  type LeaderboardRow = MonthlyStat & {
    display_name: string | null;
    points: number | null;
  };

  return (data as LeaderboardRow[]).map((d) => ({
    user_id: d.user_id,
    name: d.display_name ?? "匿名會員",
    total_km: Number(d.total_km),
    runs: Number(d.runs),
    points: Number(d.points ?? 0),
  }));
}

/** 總排行榜（依累積總公里數 + 積分） */
export async function getAllTimeLeaderboard(limit = 20): Promise<LeaderRow[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("public_leaderboard")
    .select("id, display_name, avatar_url, points, total_km")
    .order("total_km", { ascending: false })
    .order("points", { ascending: false })
    .limit(limit);

  return ((data as Profile[]) ?? []).map((p) => ({
    user_id: p.id,
    name: p.display_name ?? "匿名會員",
    total_km: Number(p.total_km),
    runs: 0,
    points: p.points,
  }));
}

/** 某會員某月的累積（只計已確認） */
export async function getUserMonthKm(
  userId: string,
  month: string = currentMonth()
): Promise<{ km: number; runs: number; pendingKm: number }> {
  const supabase = await createClient();
  if (!supabase)
    return { km: 0, runs: 0, pendingKm: 0 };

  const { data } = await supabase
    .from("run_submissions")
    .select("km, status")
    .eq("user_id", userId)
    .eq("period_month", month);

  const rows = (data ?? []) as { km: number; status: string }[];
  const approved = rows.filter((r) => r.status === "approved");
  const pending = rows.filter((r) => r.status === "pending");

  return {
    km: approved.reduce((s, r) => s + Number(r.km), 0),
    runs: approved.length,
    pendingKm: pending.reduce((s, r) => s + Number(r.km), 0),
  };
}

/** 會員自己的提交紀錄 */
export async function getUserSubmissions(
  userId: string,
  limit = 50
): Promise<RunSubmission[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("run_submissions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = (data as RunSubmission[]) ?? [];
  return await attachImageUrls(rows);
}

/** 為提交紀錄產生可讀的圖片網址（私有 bucket 用 signed URL） */
export async function attachImageUrls(
  rows: RunSubmission[]
): Promise<RunSubmission[]> {
  const supabase = await createClient();
  if (!supabase || !rows.length) return rows;

  const paths = rows.map((r) => r.image_path).filter(Boolean);
  if (!paths.length) return rows;

  const { data } = await supabase.storage
    .from("run-screenshots")
    .createSignedUrls(paths, 60 * 60);

  const urlMap = new Map<string, string>();
  (data ?? []).forEach((item) => {
    if (item.path && item.signedUrl) urlMap.set(item.path, item.signedUrl);
  });

  return rows.map((r) => ({ ...r, image_url: urlMap.get(r.image_path) ?? null }));
}

/** 會員的優惠券 */
export async function getUserCoupons(userId: string): Promise<Coupon[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("coupons")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return (data as Coupon[]) ?? [];
}

/** 會員的積分明細 */
export async function getUserPoints(
  userId: string,
  limit = 30
): Promise<PointTransaction[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("point_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data as PointTransaction[]) ?? [];
}

/** 會員的訓練紀錄 */
export async function getUserCheckins(
  userId: string,
  limit = 30
): Promise<TrainingCheckin[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("training_checkins")
    .select("*, session:training_sessions(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data as unknown as TrainingCheckin[]) ?? [];
}

/* ================= 後台查詢 ================= */

/**
 * 注意：run_submissions 有兩條指向 profiles 的外鍵（user_id / reviewed_by），
 * training_checkins 也有兩條（user_id / confirmed_by）。
 * PostgREST 必須用 `!外鍵約束名` 明確指定，否則會回 PGRST201 歧義錯誤。
 */
const RUN_PROFILE = "profile:profiles!run_submissions_user_id_fkey(id, display_name, avatar_url)";
const CHECKIN_PROFILE = "profile:profiles!training_checkins_user_id_fkey(id, display_name)";

/** 開發模式下把被吞掉的查詢錯誤印出來，避免又出現「頁面空白但沒報錯」 */
function logQueryError(where: string, error: { message: string } | null) {
  if (error && process.env.NODE_ENV !== "production") {
    console.error(`[queries] ${where} failed:`, error.message);
  }
}

export async function getPendingSubmissions(): Promise<RunSubmission[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("run_submissions")
    .select(`*, ${RUN_PROFILE}`)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);

  logQueryError("getPendingSubmissions", error);
  return await attachImageUrls((data as unknown as RunSubmission[]) ?? []);
}

export async function getSubmissionsByStatus(
  status: "pending" | "approved" | "rejected",
  limit = 100
): Promise<RunSubmission[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("run_submissions")
    .select(`*, ${RUN_PROFILE}`)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(limit);

  logQueryError("getSubmissionsByStatus", error);
  return await attachImageUrls((data as unknown as RunSubmission[]) ?? []);
}

export async function getPendingCheckins(): Promise<TrainingCheckin[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("training_checkins")
    .select(`*, session:training_sessions(*), ${CHECKIN_PROFILE}`)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);

  logQueryError("getPendingCheckins", error);
  return (data as unknown as TrainingCheckin[]) ?? [];
}

/** 全部會員（後台手動發券用） */
export async function getAllMembers(): Promise<
  { id: string; display_name: string | null }[]
> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("profiles")
    .select("id, display_name")
    .order("created_at", { ascending: true })
    .limit(500);

  return (data as { id: string; display_name: string | null }[]) ?? [];
}

export interface QualifiedRow {
  user_id: string;
  name: string | null;
  email: string | null;
  total_km: number;
  runs: number;
  has_coupon: boolean;
}

/** 後台：某月達標名單（≥300km） */
export async function getQualifiedList(
  month: string = currentMonth()
): Promise<QualifiedRow[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc("monthly_qualified_list", {
    p_month: month,
  });
  if (error || !data) return [];

  return ((data as unknown as QualifiedRow[]) ?? []).map((r) => ({
    ...r,
    total_km: Number(r.total_km),
    runs: Number(r.runs),
  }));
}

/** 後台：某月所有人的累積（含未達標，供參考） */
export async function getMonthOverview(month: string = currentMonth()) {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("monthly_running_stats")
    .select("user_id, period_month, total_km, runs")
    .eq("period_month", month)
    .order("total_km", { ascending: false })
    .limit(200);

  const rows = (data as MonthlyStat[]) ?? [];
  if (!rows.length) return [];

  const ids = rows.map((r) => r.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", ids);
  const pmap = new Map<string, string>(
    ((profiles as Profile[]) ?? []).map((p) => [p.id, p.display_name ?? "匿名"])
  );

  return rows.map((r) => ({ ...r, name: pmap.get(r.user_id) ?? "匿名" }));
}

export async function getAllCoupons(limit = 200): Promise<Coupon[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("coupons")
    // 2026-09-25 修復：coupons 有兩個 FK 指向 profiles（user_id、redeemed_by），
    // 不加 hint 會觸發 PGRST201「more than one relationship」導致整表查回空陣列，
    // 後台總覽顯示 3 張、列表卻顯示 0 張。明確指定走 user_id 的 FK。
    .select("*, profile:profiles!coupons_user_id_fkey(id, display_name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data as unknown as Coupon[]) ?? [];
}

export async function getAdminCounts() {
  const supabase = await createClient();
  if (!supabase)
    return { pendingRuns: 0, pendingCheckins: 0, coupons: 0, members: 0 };

  const [{ count: pendingRuns }, { count: pendingCheckins }, { count: coupons }, { count: members }] =
    await Promise.all([
      supabase
        .from("run_submissions")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("training_checkins")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("coupons")
        .select("*", { count: "exact", head: true })
        .eq("status", "active"),
      supabase.from("profiles").select("*", { count: "exact", head: true }),
    ]);

  return {
    pendingRuns: pendingRuns ?? 0,
    pendingCheckins: pendingCheckins ?? 0,
    coupons: coupons ?? 0,
    members: members ?? 0,
  };
}

export { monthLabel };
