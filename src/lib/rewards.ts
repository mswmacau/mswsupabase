/**
 * src/lib/rewards.ts — 積分換領（會員端）的資料層
 *
 * 資料來源（已上線，前端不可自行計算扣分／庫存）：
 *   - rewards / reward_redemptions：RLS 只給會員讀自己的兌換列；rewards 只讀 status='active'
 *   - merchants：RLS 只給 admin，故核銷商戶名一律經 rpc('merchant_public_list')
 *   - app_settings.rewards_enabled：止血開關；false 時入口隱藏、兌換 RPC 回 FEATURE_OFF
 *
 * 兌換本身只經 rpc('redeem_reward')，本檔不含任何寫入。
 */

import { createClient } from "./supabase/server";
import { anonClient } from "./supabase/anon";
import type { PointTransaction } from "./types";

export interface Reward {
  id: string;
  name: string;
  description: string | null;
  image_path: string | null;
  points_cost: number;
  stock_total: number | null;
  stock_remaining: number | null;
  per_user_limit: number | null;
  merchant_id: string;
  status: "active" | "inactive";
  sort_order: number;
}

export interface RewardCardData extends Reward {
  /** 由 merchant_public_list() 對照；查不到時為 null */
  merchant_name: string | null;
  /** 本人已兌換次數（只計 pending／pending_approval／completed，與 RPC 的每人上限一致） */
  redeemed_count: number;
}

export type RedemptionStatus =
  | "pending"
  | "pending_approval"
  | "completed"
  | "cancelled";

export interface RedemptionRow {
  id: string;
  reward_id: string;
  reward_name: string;
  reward_image_path: string | null;
  points_spent: number;
  status: RedemptionStatus;
  pickup_code: string | null;
  merchant_name: string | null;
  expires_at: string | null;
  created_at: string;
  decided_at: string | null;
  merchant_verified_at: string | null;
}

export const REDEMPTION_STATUS_LABEL: Record<RedemptionStatus, string> = {
  pending: "待領取",
  pending_approval: "待審批",
  completed: "已領取",
  cancelled: "已取消",
};

/** 兌換申請需年滿 7 日才會即時生效（RPC 會回 pending_approval） */
export function isNewMember(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < 7 * 24 * 60 * 60 * 1000;
}

/** 待領取但已過期的券（DB 沒有 expired 狀態，過期只在顯示層判斷） */
export function isRedemptionExpired(
  status: RedemptionStatus,
  expiresAt: string | null
): boolean {
  if (status !== "pending" || !expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

/** "A2B3C4D5E6F7" → "A2B3-C4D5-E6F7"（每 4 字一組） */
export function groupPickupCode(code: string | null): string {
  if (!code) return "";
  const clean = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return clean.match(/.{1,4}/g)?.join("-") ?? "";
}

/** Asia/Macau 曆月（YYYY-MM）；避免伺服器 UTC 時區在月初／月末算錯月份 */
function macauMonth(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Macau",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

/** 本月起點（澳門時間） */
function macauMonthStartISO(): string {
  return `${macauMonth()}-01T00:00:00+08:00`;
}

/** 止血開關；讀不到一律視為關閉（寧願隱藏入口，也不要顯示壞頁） */
export async function getRewardsEnabled(): Promise<boolean> {
  const supabase = anonClient();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "rewards_enabled")
    .maybeSingle();

  if (error || !data) return false;
  return data.value === true || data.value === "true";
}

/** 核銷商戶 id → 名稱（merchants 受 RLS 保護，只能經 RPC 取公開名稱） */
async function merchantNameMap(): Promise<Map<string, string>> {
  const supabase = await createClient();
  if (!supabase) return new Map();

  const { data, error } = await supabase.rpc("merchant_public_list");
  if (error || !Array.isArray(data)) return new Map();

  const map = new Map<string, string>();
  for (const row of data as { id?: unknown; name?: unknown }[]) {
    if (typeof row?.id === "string" && typeof row?.name === "string") {
      map.set(row.id, row.name);
    }
  }
  return map;
}

/** 本人對各禮品的已兌換次數（與 RPC 的 per_user_limit 計數口徑一致） */
async function redeemedCountMap(userId: string): Promise<Map<string, number>> {
  const supabase = await createClient();
  if (!supabase) return new Map();

  const { data, error } = await supabase
    .from("reward_redemptions")
    .select("reward_id")
    .eq("user_id", userId)
    .in("status", ["pending", "pending_approval", "completed"]);

  if (error || !data) return new Map();

  const map = new Map<string, number>();
  for (const row of data as { reward_id: string }[]) {
    map.set(row.reward_id, (map.get(row.reward_id) ?? 0) + 1);
  }
  return map;
}

function toRewardCard(
  row: Reward,
  merchants: Map<string, string>,
  counts: Map<string, number>
): RewardCardData {
  return {
    ...row,
    points_cost: Number(row.points_cost),
    stock_total: row.stock_total === null ? null : Number(row.stock_total),
    stock_remaining:
      row.stock_remaining === null ? null : Number(row.stock_remaining),
    per_user_limit:
      row.per_user_limit === null ? null : Number(row.per_user_limit),
    merchant_name: merchants.get(row.merchant_id) ?? null,
    redeemed_count: counts.get(row.id) ?? 0,
  };
}

/** 禮品目錄（只列上架中；順序由後台 sort_order 決定） */
export async function getRewardCatalog(userId: string): Promise<RewardCardData[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const [{ data, error }, merchants, counts] = await Promise.all([
    supabase
      .from("rewards")
      .select("*")
      .eq("status", "active")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
    merchantNameMap(),
    redeemedCountMap(userId),
  ]);

  if (error || !data) return [];

  return (data as Reward[]).map((r) => toRewardCard(r, merchants, counts));
}

/** 單一禮品；已下架（RLS 讀不到）回 null，頁面應顯示「已下架」 */
export async function getRewardDetail(
  id: string,
  userId: string
): Promise<RewardCardData | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const [{ data, error }, merchants, counts] = await Promise.all([
    supabase.from("rewards").select("*").eq("id", id).maybeSingle(),
    merchantNameMap(),
    redeemedCountMap(userId),
  ]);

  if (error || !data) return null;
  return toRewardCard(data as Reward, merchants, counts);
}

/** 我的兌換（新到舊） */
export async function getMyRedemptions(userId: string): Promise<RedemptionRow[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const [{ data, error }, merchants] = await Promise.all([
    supabase
      .from("reward_redemptions")
      .select(
        "id, reward_id, points_spent, status, pickup_code, merchant_id, expires_at, created_at, decided_at, merchant_verified_at"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100),
    merchantNameMap(),
  ]);

  if (error || !data) return [];

  const rows = data as {
    id: string;
    reward_id: string;
    points_spent: number;
    status: RedemptionStatus;
    pickup_code: string | null;
    merchant_id: string | null;
    expires_at: string | null;
    created_at: string;
    decided_at: string | null;
    merchant_verified_at: string | null;
  }[];

  const rewardIds = [...new Set(rows.map((r) => r.reward_id))];
  const rewards = new Map<string, { name: string; image_path: string | null }>();

  if (rewardIds.length) {
    const { data: rewardRows } = await supabase
      .from("rewards")
      .select("id, name, image_path")
      .in("id", rewardIds);

    for (const r of (rewardRows ?? []) as {
      id: string;
      name: string;
      image_path: string | null;
    }[]) {
      rewards.set(r.id, { name: r.name, image_path: r.image_path });
    }
  }

  return rows.map((r) => ({
    id: r.id,
    reward_id: r.reward_id,
    reward_name: rewards.get(r.reward_id)?.name ?? "禮品（已下架）",
    reward_image_path: rewards.get(r.reward_id)?.image_path ?? null,
    points_spent: Number(r.points_spent),
    status: r.status,
    pickup_code: r.pickup_code,
    merchant_name: r.merchant_id ? merchants.get(r.merchant_id) ?? null : null,
    expires_at: r.expires_at,
    created_at: r.created_at,
    decided_at: r.decided_at,
    merchant_verified_at: r.merchant_verified_at,
  }));
}

/** 現時積分 + 本月收入／支出（餘額以 profiles 為準） */
export async function getMyPointsSummary(
  userId: string
): Promise<{ balance: number; earnedThisMonth: number; spentThisMonth: number }> {
  const supabase = await createClient();
  if (!supabase) return { balance: 0, earnedThisMonth: 0, spentThisMonth: 0 };

  const [{ data: profile }, { data: rows }] = await Promise.all([
    supabase.from("profiles").select("points").eq("id", userId).maybeSingle(),
    supabase
      .from("point_transactions")
      .select("delta")
      .eq("user_id", userId)
      .gte("created_at", macauMonthStartISO())
      .limit(2000),
  ]);

  let earned = 0;
  let spent = 0;
  for (const r of (rows ?? []) as { delta: number }[]) {
    const d = Number(r.delta);
    if (d > 0) earned += d;
    else spent += -d;
  }

  return {
    balance: Number(profile?.points ?? 0),
    earnedThisMonth: earned,
    spentThisMonth: spent,
  };
}

/** 積分明細（分頁；hasMore 以多取一筆判斷，不做 count 查詢） */
export async function getPointLedger(
  userId: string,
  limit = 20,
  offset = 0
): Promise<{ rows: PointTransaction[]; hasMore: boolean }> {
  const supabase = await createClient();
  if (!supabase) return { rows: [], hasMore: false };

  const size = Math.min(Math.max(limit, 1), 50);
  const from = Math.max(offset, 0);

  const { data, error } = await supabase
    .from("point_transactions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(from, from + size);

  if (error || !data) return { rows: [], hasMore: false };

  const all = data as PointTransaction[];
  return { rows: all.slice(0, size), hasMore: all.length > size };
}
