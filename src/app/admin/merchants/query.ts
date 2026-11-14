import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { MerchantRow } from "./types";

/**
 * 商戶列表的伺服器端取數（從 merchants/page.tsx 抽出來的共用函式）。
 *
 * 為什麼要抽：IA 第二階段把「商戶管理」併進 `/admin/redemptions?tab=merchants`，
 * 舊路由 `/admin/merchants` 仍保留（可能有人 bookmark）。兩邊必須讀同一份資料、
 * 用同一條「pin_hash 只留布林值」的規則——否則明碼雜湊有機會跟著 row 一起被
 * 序列化到 client component 的 props 裡。
 */
export interface MerchantsResult {
  merchants: MerchantRow[];
  loadError: boolean;
  notConfigured: boolean;
}

export async function loadMerchants(): Promise<MerchantsResult> {
  if (!isSupabaseConfigured) {
    return { merchants: [], loadError: true, notConfigured: true };
  }

  const supabase = await createClient();
  if (!supabase) return { merchants: [], loadError: true, notConfigured: false };

  const { data, error } = await supabase
    .from("merchants")
    .select("id,name,contact_note,must_reset,pin_valid_days,pin_expires_at,status,created_at,pin_hash")
    .order("created_at", { ascending: true });

  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[admin/merchants] query failed:", error.message);
    }
    return { merchants: [], loadError: true, notConfigured: false };
  }

  // pin_hash 只留布林值，其餘一律丟掉
  const merchants = ((data ?? []) as unknown as (MerchantRow & { pin_hash?: string | null })[]).map(
    (row) => {
      const { pin_hash, ...rest } = row;
      return {
        ...rest,
        pin_valid_days: Number(rest.pin_valid_days ?? 90),
        has_pin: Boolean(pin_hash),
      };
    }
  );

  return { merchants, loadError: false, notConfigured: false };
}
