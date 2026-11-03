/** /admin/merchants 的資料型別（pin_hash 永不回傳，只給 has_pin） */

export type MerchantStatus = "active" | "inactive";

export interface MerchantRow {
  id: string;
  name: string;
  contact_note: string | null;
  must_reset: boolean;
  pin_valid_days: number;
  pin_expires_at: string | null;
  status: MerchantStatus;
  created_at: string;
  has_pin: boolean;
}
