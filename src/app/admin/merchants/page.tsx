import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { MerchantsManager } from "./MerchantsManager";
import type { MerchantRow } from "./types";

export const metadata = { title: "商戶管理" };
export const dynamic = "force-dynamic";

/**
 * /admin/merchants — 核銷商戶與 PIN
 *
 * 這裡只讀「有沒有 PIN、有效到幾時」；pin_hash 不會離開資料庫。
 * 產生／重設 PIN 由 /api/admin/merchants 呼叫 DB 函式（明文只回一次）。
 */
export default async function AdminMerchantsPage() {
  if (!isSupabaseConfigured) {
    return (
      <Shell>
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          尚未連接 Supabase，暫時無法讀取商戶資料。
        </div>
      </Shell>
    );
  }

  const supabase = await createClient();
  let merchants: MerchantRow[] = [];
  let loadError = false;

  if (supabase) {
    const { data, error } = await supabase
      .from("merchants")
      .select("id,name,contact_note,must_reset,pin_valid_days,pin_expires_at,status,created_at,pin_hash")
      .order("created_at", { ascending: true });

    if (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[admin/merchants] query failed:", error.message);
      }
      loadError = true;
    } else {
      // pin_hash 只留布林值，其餘一律丟掉
      merchants = ((data ?? []) as unknown as (MerchantRow & { pin_hash?: string | null })[]).map(
        (row) => {
          const { pin_hash, ...rest } = row;
          return {
            ...rest,
            pin_valid_days: Number(rest.pin_valid_days ?? 90),
            has_pin: Boolean(pin_hash),
          };
        }
      );
    }
  } else {
    loadError = true;
  }

  return (
    <Shell>
      {loadError ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          商戶資料暫時讀不到，請稍後重新整理；若持續失敗請聯絡技術人員。
        </div>
      ) : (
        <MerchantsManager initialMerchants={merchants} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h2 className="text-xl font-bold">商戶管理</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          核銷商戶與其 6 位 PIN。PIN 只儲存加密雜湊，產生時顯示一次——
          請即場抄下或列印 PIN 卡交給店員，遺失只能重設。
        </p>
      </div>
      {children}
    </div>
  );
}
