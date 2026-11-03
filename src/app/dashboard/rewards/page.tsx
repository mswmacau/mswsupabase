import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Gift, Sparkles } from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/server";
import {
  getMyPointsSummary,
  getRewardCatalog,
  getRewardsEnabled,
} from "@/lib/rewards";
import { RewardCard } from "@/components/RewardCard";
import { RewardsComingSoon } from "@/components/RewardsComingSoon";
import { RULES } from "@/lib/config";

export const metadata = { title: "禮品換領" };
export const dynamic = "force-dynamic";

export default async function RewardsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/dashboard/rewards");

  const enabled = await getRewardsEnabled();

  const [rewards, summary] = enabled
    ? await Promise.all([
        getRewardCatalog(profile.id),
        getMyPointsSummary(profile.id),
      ])
    : [[], { balance: profile.points, earnedThisMonth: 0, spentThisMonth: 0 }];

  return (
    <section className="relative overflow-hidden pb-20 pt-24 md:pt-28">
      <div
        className="pointer-events-none absolute -right-[15%] -top-[26%] h-[520px] w-[520px] rounded-full blur-[130px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--color-vital) 60%, transparent), transparent 66%)",
          opacity: 0.26,
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
            Rewards
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="display-xl mt-6">
              <span className="block text-white">禮品</span>
              <span className="mt-1 block">
                <span className="text-outline">換</span>
                <span className="text-vital-bright">領</span>
              </span>
            </h1>
            <p className="mt-8 max-w-xl text-base leading-relaxed text-white/70">
              用積分換實體禮品。兌換後到核銷商戶出示 QR 碼或領取碼，由店員即場核銷。
            </p>
          </div>
        </div>

        {!enabled ? (
          <RewardsComingSoon />
        ) : (
          <>
            {/* 積分帶：數字主導，說明放右邊 */}
            <div className="mt-10 grid gap-4 border border-[var(--line-fine)] bg-white/[0.03] p-6 md:grid-cols-[auto_1fr] md:items-center md:gap-10 md:p-8">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/55">
                  我的積分
                </div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="stat-figure text-6xl text-white md:text-7xl">
                    {summary.balance}
                  </span>
                  <span className="text-xs font-bold uppercase tracking-[0.22em] text-vital-bright">
                    pts
                  </span>
                </div>
                <div className="mt-3 inline-flex items-center gap-1.5 text-sm text-emerald-300">
                  <Sparkles size={14} /> 本月已賺 {summary.earnedThisMonth} 分
                </div>
              </div>

              <div className="border-t border-[var(--line-fine)] pt-4 md:border-l md:border-t-0 md:pl-8 md:pt-0">
                <p className="text-sm leading-relaxed text-white/70">
                  跑步每公里 +{RULES.POINTS_PER_KM} 分、訓練簽到 +{RULES.CHECKIN_POINTS}{" "}
                  分、每日登入 +10 分；後台確認後入帳，積分以系統紀錄為準。
                </p>
                <Link
                  href="/dashboard/points"
                  className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent-blue transition hover:text-white"
                >
                  看積分明細 <ArrowRight size={15} />
                </Link>
              </div>
            </div>

            <div className="mt-12">
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--line-fine)] pb-4">
                <h2 className="flex items-center gap-2 text-lg font-black tracking-tight">
                  <Gift size={18} className="text-vital-bright" /> 可換領禮品
                </h2>
                <span className="stat-figure text-2xl text-vital-bright">
                  {rewards.length}
                  <span className="ml-1 font-sans text-xs font-medium text-white/55">
                    款
                  </span>
                </span>
              </div>

              <div className="stagger mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {rewards.length ? (
                  rewards.map((r) => (
                    <RewardCard key={r.id} reward={r} points={summary.balance} />
                  ))
                ) : (
                  <div className="clip-notch-br border border-dashed border-white/15 px-6 py-14 text-center sm:col-span-2 lg:col-span-3">
                    <span className="mx-auto flex h-12 w-12 items-center justify-center border border-[var(--line-fine)] text-vital-bright">
                      <Gift size={22} />
                    </span>
                    <p className="mt-5 text-sm text-white/70">
                      暫時未有禮品上架。新禮品上架會在這裡出現，請留意公告。
                    </p>
                    <Link
                      href="/run"
                      className="btn-base btn-vital btn-slab mt-6 min-h-11"
                    >
                      先去跑步賺分 <ArrowRight size={16} />
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
