/** /admin/redemptions 的資料型別（對齊 reward_redemptions 與 API 回傳） */

export type RedemptionStatus = "pending_approval" | "pending" | "completed" | "cancelled";

export interface RedemptionUser {
  id: string;
  display_name: string | null;
  created_at: string;
}

export interface RedemptionRow {
  id: string;
  pickup_code: string | null;
  status: RedemptionStatus;
  points_spent: number;
  created_at: string;
  decided_at: string | null;
  merchant_verified_at: string | null;
  expires_at: string | null;
  note: string | null;
  redeemed_via: "admin" | "merchant_page" | null;
  user: RedemptionUser | null;
  reward: { id: string; name: string } | null;
  merchant: { id: string; name: string } | null;
}

export type StatusCounts = Record<string, number>;
