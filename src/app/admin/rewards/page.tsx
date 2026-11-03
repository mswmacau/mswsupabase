import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { RewardsManager } from "./RewardsManager";
import type { MerchantOption, RewardRow } from "./types";

export const metadata = { title: "禮品管理" };
export const dynamic = "force-dynamic";

/**
 * /admin/rewards — 禮品目錄管理
 *
 * 權限由 src/app/admin/layout.tsx 統一把關；這裡只在伺服器端取初始資料，
 * 所有寫入都經 /api/admin/rewards（後端再驗一次管理員）。
 * 取數失敗時顯示可讀提示，不讓整頁 500。
 */
export default async function AdminRewardsPage() {
  if (!isSupabaseConfigured) {
    return (
      <Shell>
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          尚未連接 Supabase，暫時無法讀取禮品資料。
        </div>
      </Shell>
    );
  }

  const supabase = await createClient();
  let rewards: RewardRow[] = [];
  let merchants: MerchantOption[] = [];
  let loadError = false;

  if (supabase) {
    const [{ data, error }, { data: merchantRows, error: merchantError }] = await Promise.all([
      supabase
        .from("rewards")
        .select(
          "id,name,description,image_path,points_cost,stock_total,stock_remaining,per_user_limit,merchant_id,status,sort_order,created_at,merchant:merchants(id,name)"
        )
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false }),
      supabase.rpc("merchant_public_list"),
    ]);

    if (error || merchantError) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[admin/rewards] query failed:", error?.message ?? merchantError?.message);
      }
      loadError = true;
    } else {
      rewards = ((data ?? []) as unknown as RewardRow[]).map((row) => ({
        ...row,
        points_cost: Number(row.points_cost),
        stock_total: row.stock_total === null ? null : Number(row.stock_total),
        stock_remaining: row.stock_remaining === null ? null : Number(row.stock_remaining),
        per_user_limit: row.per_user_limit === null ? null : Number(row.per_user_limit),
        sort_order: Number(row.sort_order ?? 0),
        merchant: Array.isArray(row.merchant) ? row.merchant[0] ?? null : row.merchant,
      }));
      merchants = ((merchantRows ?? []) as MerchantOption[]).filter(
        (m) => typeof m?.id === "string" && typeof m?.name === "string"
      );
    }
  } else {
    loadError = true;
  }

  return (
    <Shell>
      {loadError ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          禮品資料暫時讀不到，請稍後重新整理；若持續失敗請聯絡技術人員。
        </div>
      ) : (
        <RewardsManager initialRewards={rewards} merchants={merchants} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h2 className="text-xl font-bold">禮品管理</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          管理會員可用積分換領的禮品：積分價、庫存、每人上限、核銷商戶與上下架。
          已有人兌換的禮品不提供刪除，只能下架。
        </p>
      </div>
      {children}
    </div>
  );
}
