import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { RedemptionRow, StatusCounts } from "./types";

/**
 * 兌換紀錄的伺服器端取數（從 redemptions/page.tsx 抽出來的共用函式）。
 *
 * 為什麼要抽：IA 第二階段後，「兌換紀錄」有兩個呈現位置——
 *   1. /admin/redemptions（完整紀錄：全部／待審批／待領取／已完成／已取消）
 *   2. /admin/review?tab=redemptions（只列待審批，也就是每天要按的那幾筆）
 * 兩邊若各寫一份查詢，欄位清單、limit、錯誤處理會慢慢分岔，最後出現
 * 「同一筆券在兩頁顯示不同會員」這種查不出來的 bug。
 *
 * 查詢內容與 HEAD 版本的 redemptions/page.tsx **完全一致**：
 * 同一個 select 欄位清單、同樣 order created_at desc、limit 100、
 * 同樣的搜尋方式（先用會員名找 id，再 combined or filter）、
 * 同樣 5 個 count（all + 4 狀態）。
 */

const STATUSES = ["pending_approval", "pending", "completed", "cancelled"] as const;

export type RedemptionStatus = (typeof STATUSES)[number] | "all";

export interface RedemptionsResult {
  rows: RedemptionRow[];
  counts: StatusCounts;
  /** 查詢失敗（含未連接 Supabase）→ 頁面顯示可讀錯誤，不要空白 */
  loadError: boolean;
  /** 沒設定 Supabase 環境變數：文案與一般錯誤不同（給工程師看的） */
  notConfigured: boolean;
}

export async function loadRedemptions({
  status,
  q,
}: {
  status: RedemptionStatus;
  q: string;
}): Promise<RedemptionsResult> {
  const empty: StatusCounts = {
    all: 0,
    pending_approval: 0,
    pending: 0,
    completed: 0,
    cancelled: 0,
  };

  if (!isSupabaseConfigured) {
    return { rows: [], counts: empty, loadError: true, notConfigured: true };
  }

  const supabase = await createClient();
  if (!supabase) {
    return { rows: [], counts: empty, loadError: true, notConfigured: false };
  }

  /* 搜尋：先以會員名找 id，再 combined filter，避免依賴 embedded or */
  let matchedUserIds: string[] = [];
  if (q) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id")
      .ilike("display_name", `%${q}%`)
      .limit(50);
    matchedUserIds = (profiles ?? []).map((p) => (p as { id: string }).id);
  }

  let query = supabase
    .from("reward_redemptions")
    .select(
      `id,pickup_code,status,points_spent,created_at,decided_at,merchant_verified_at,expires_at,note,redeemed_via,
       user:profiles!user_id(id,display_name,created_at),
       reward:rewards(id,name),
       merchant:merchants(id,name)`
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (status !== "all") query = query.eq("status", status);
  if (q) {
    const escaped = q.replace(/[(),]/g, " ");
    query = matchedUserIds.length
      ? query.or(`pickup_code.ilike.%${escaped}%,user_id.in.(${matchedUserIds.join(",")})`)
      : query.ilike("pickup_code", `%${escaped}%`);
  }

  const [list, allCount, ...statusCounts] = await Promise.all([
    query,
    supabase.from("reward_redemptions").select("id", { count: "exact", head: true }),
    ...STATUSES.map((s) =>
      supabase
        .from("reward_redemptions")
        .select("id", { count: "exact", head: true })
        .eq("status", s)
    ),
  ]);

  const counts: StatusCounts = { ...empty };

  if (list.error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[admin/redemptions] query failed:", list.error.message);
    }
    return { rows: [], counts, loadError: true, notConfigured: false };
  }

  const rows = ((list.data ?? []) as unknown as RedemptionRow[]).map((row) => ({
    ...row,
    points_spent: Number(row.points_spent),
    user: Array.isArray(row.user) ? row.user[0] ?? null : row.user,
    reward: Array.isArray(row.reward) ? row.reward[0] ?? null : row.reward,
    merchant: Array.isArray(row.merchant) ? row.merchant[0] ?? null : row.merchant,
  }));

  counts.all = allCount.count ?? 0;
  STATUSES.forEach((s, index) => {
    counts[s] = statusCounts[index].count ?? 0;
  });

  return { rows, counts, loadError: false, notConfigured: false };
}

export const REDEMPTION_STATUSES = STATUSES;
