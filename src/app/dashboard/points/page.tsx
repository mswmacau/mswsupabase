import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getMyPointsSummary, getPointLedger } from "@/lib/rewards";
import { PointsLedger } from "@/components/PointsLedger";

export const metadata = { title: "積分明細" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function PointsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/dashboard/points");

  const [summary, ledger] = await Promise.all([
    getMyPointsSummary(profile.id),
    getPointLedger(profile.id, PAGE_SIZE, 0),
  ]);

  return (
    <section className="relative overflow-hidden pb-20 pt-24 md:pt-28">
      <div
        className="pointer-events-none absolute -left-[15%] -top-[26%] h-[520px] w-[520px] rounded-full blur-[130px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--color-vital) 55%, transparent), transparent 66%)",
          opacity: 0.24,
        }}
      />
      <div className="grid-lines absolute inset-0" />
      <div className="noise-overlay" />

      <div className="container-msw relative z-10">
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-white/70 transition hover:text-white"
        >
          <ArrowLeft size={15} /> 回我的帳戶
        </Link>

        <div className="mt-6 flex gap-6">
          <span className="vlabel hidden shrink-0 text-white/40 lg:block">
            Points
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="display-xl mt-6">
              <span className="block text-white">積分</span>
              <span className="mt-1 block text-vital-bright">明細</span>
            </h1>
            <p className="mt-8 max-w-xl text-base leading-relaxed text-white/70">
              每一筆加減分都在這裡。跑步與簽到由後台確認後入帳，兌換即時扣分。
            </p>
          </div>
        </div>

        {/* 三個數字：現時積分主導，收支在右 */}
        <div className="mt-10 grid gap-4 border border-[var(--line-fine)] bg-white/[0.03] p-6 sm:grid-cols-3 sm:gap-0 sm:p-0">
          <div className="sm:p-7">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-white/55">
              <Wallet size={14} /> 現時積分
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="stat-figure text-5xl text-white md:text-6xl">
                {summary.balance}
              </span>
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-vital-bright">
                pts
              </span>
            </div>
          </div>

          <div className="border-t border-[var(--line-fine)] pt-5 sm:border-l sm:border-t-0 sm:p-7">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-white/55">
              <TrendingUp size={14} /> 本月收入
            </div>
            <div className="stat-figure mt-2 text-3xl text-emerald-400">
              {summary.earnedThisMonth > 0 ? `+${summary.earnedThisMonth}` : "0"}
            </div>
          </div>

          <div className="border-t border-[var(--line-fine)] pt-5 sm:border-l sm:border-t-0 sm:p-7">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-white/55">
              <TrendingDown size={14} /> 本月支出
            </div>
            <div className="stat-figure mt-2 text-3xl text-red-400">
              {summary.spentThisMonth > 0 ? `-${summary.spentThisMonth}` : "0"}
            </div>
          </div>
        </div>

        <div className="mt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--line-fine)] pb-4">
            <h2 className="text-lg font-black tracking-tight">紀錄</h2>
            <Link
              href="/dashboard/rewards"
              className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-vital-bright transition hover:text-white"
            >
              去換禮品 <ArrowRight size={15} />
            </Link>
          </div>

          <div className="mt-5">
            <PointsLedger
              initialRows={ledger.rows}
              initialHasMore={ledger.hasMore}
              emptyText="還沒有積分紀錄。上傳跑步紀錄或報名訓練簽到，後台確認後就會入帳；每日登入也有 +10 分。"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
