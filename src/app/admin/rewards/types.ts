/** /admin/rewards 的資料型別（對齊 supabase rewards 表與 API 回傳） */

export type RewardStatus = "active" | "inactive";

export interface RewardRow {
  id: string;
  name: string;
  description: string | null;
  image_path: string | null;
  points_cost: number;
  stock_total: number | null;
  stock_remaining: number | null;
  per_user_limit: number | null;
  merchant_id: string;
  status: RewardStatus;
  sort_order: number;
  created_at: string;
  merchant: { id: string; name: string } | null;
}

export interface MerchantOption {
  id: string;
  name: string;
}

/** 表單送出的欄位（總庫存／每人上限留空 = null） */
export interface RewardInput {
  name: string;
  description: string;
  points_cost: number | null;
  stock_total: number | null;
  per_user_limit: number | null;
  merchant_id: string;
  status: RewardStatus;
  sort_order: number;
  image_path: string | null;
}
