import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { RedemptionsView } from "./RedemptionsView";
import type { RedemptionRow, StatusCounts } from "./types";

export const metadata = { title: "兌換管理" };
export const dynamic = "force-dynamic";

const STATUSES = ["pending_approval", "pending", "completed", "cancelled"] as const;

/**
 * /admin/redemptions — 兌換紀錄（電子券）管理
 *
 * 取數在伺服器端完成（依 ?status= 與 ?q=），操作一律打 /api/admin/redemptions。
 * 拒絕／取消會退分與回庫存，全部由 DB 函式處理，本頁不自行計算金額。
 */
export default async function AdminRedemptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const status = (STATUSES as readonly string[]).includes(params.status ?? "")
    ? (params.status as (typeof STATUSES)[number])
    : "all";
  const q = (params.q ?? "").trim().slice(0, 60);

  if (!isSupabaseConfigured) {
    return (
      <Shell>
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          尚未連接 Supabase，暫時無法讀取兌換紀錄。
        </div>
      </Shell>
    );
  }

  const supabase = await createClient();
  let rows: RedemptionRow[] = [];
  const counts: StatusCounts = { all: 0, pending_approval: 0, pending: 0, completed: 0, cancelled: 0 };
  let loadError = false;

  if (supabase) {
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

    if (list.error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[admin/redemptions] query failed:", list.error.message);
      }
      loadError = true;
    } else {
      rows = ((list.data ?? []) as unknown as RedemptionRow[]).map((row) => ({
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
    }
  } else {
    loadError = true;
  }

  return (
    <Shell>
      {loadError ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          兌換紀錄暫時讀不到，請稍後重新整理；若持續失敗請聯絡技術人員。
        </div>
      ) : (
        <RedemptionsView
          key={`${status}:${q}`}
          rows={rows}
          counts={counts}
          status={status}
          q={q}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h2 className="text-xl font-bold">兌換管理</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          審批新會員的兌換申請、替現場券做後備核銷。拒絕或取消都會退回積分並回補庫存，
          操作前請先確認券碼與會員。
        </p>
      </div>
      {children}
    </div>
  );
}
