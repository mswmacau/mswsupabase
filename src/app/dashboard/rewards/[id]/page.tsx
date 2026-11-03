import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  Gift,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/server";
import {
  getRewardDetail,
  getRewardsEnabled,
  isNewMember,
} from "@/lib/rewards";
import { publicAssetUrl } from "@/lib/assets";
import { RedeemPanel } from "@/components/RedeemPanel";
import { RewardsComingSoon } from "@/components/RewardsComingSoon";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CUT_MD = { "--cut": "20px" } as CSSProperties;

export default async function RewardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const profile = await getCurrentProfile();
  if (!profile) redirect(`/login?next=/dashboard/rewards/${id}`);

  const enabled = await getRewardsEnabled();
  if (!enabled) {
    return (
      <section className="relative overflow-hidden pb-20 pt-24 md:pt-28">
        <div className="grid-lines absolute inset-0" />
        <div className="noise-overlay" />
        <div className="container-msw relative z-10">
          <Link
            href="/dashboard/rewards"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-white/70 transition hover:text-white"
          >
            <ArrowLeft size={15} /> 回禮品目錄
          </Link>
          <RewardsComingSoon />
        </div>
      </section>
    );
  }

  const reward = await getRewardDetail(id, profile.id);
  if (!reward) notFound();

  const points = profile.points;
  const cost = reward.points_cost;
  const remainingAfter = Math.max(points - cost, 0);
  const shortfall = cost - points;
  const soldOut = reward.stock_remaining !== null && reward.stock_remaining <= 0;
  const hitLimit =
    reward.per_user_limit !== null && reward.redeemed_count >= reward.per_user_limit;
  const newMember = isNewMember(profile.created_at);

  const disabledReason = soldOut
    ? "已換完"
    : hitLimit
      ? "已達上限"
      : shortfall > 0
        ? `差 ${shortfall} 分`
        : null;

  const image = publicAssetUrl(reward.image_path);

  return (
    <section className="relative overflow-hidden pb-20 pt-24 md:pt-28">
      <div
        className="pointer-events-none absolute -left-[18%] -top-[24%] h-[520px] w-[520px] rounded-full blur-[130px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--color-vital) 55%, transparent), transparent 66%)",
          opacity: 0.22,
        }}
      />
      <div className="grid-lines absolute inset-0" />
      <div className="noise-overlay" />

      <div className="container-msw relative z-10">
        <Link
          href="/dashboard/rewards"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-white/70 transition hover:text-white"
        >
          <ArrowLeft size={15} /> 回禮品目錄
        </Link>

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-12">
          {/* 大圖 */}
          <div
            style={CUT_MD}
            className="clip-notch-br relative aspect-[4/3] w-full overflow-hidden border border-[var(--line-fine)] bg-gradient-to-br from-cobalt/35 via-ink-soft to-ink"
          >
            <div className="hero-grid absolute inset-0 opacity-25" />
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt={reward.name}
                className="h-full w-full object-cover"
                decoding="async"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/45">
                <Gift size={56} className="text-vital-bright/80" />
                <span className="text-[11px] uppercase tracking-[0.22em]">
                  MSW Reward
                </span>
              </div>
            )}
          </div>

          {/* 內容 */}
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.22em] text-vital-bright">
              Reward · 積分換領
            </div>
            <h1 className="mt-3 text-3xl font-black leading-tight tracking-tight text-white md:text-4xl">
              {reward.name}
            </h1>

            {reward.description && (
              <p className="mt-4 text-sm leading-relaxed text-white/70">
                {reward.description}
              </p>
            )}

            {/* 五行資料列：順序固定，店員與會員用同一組順序核對 */}
            <dl className="mt-6 border-t border-[var(--line-fine)]">
              <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line-fine)] py-3">
                <dt className="text-sm text-white/60">所需積分</dt>
                <dd className="stat-figure text-lg text-vital-bright">
                  {cost} 分
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line-fine)] py-3">
                <dt className="text-sm text-white/60">我的積分</dt>
                <dd className="stat-figure text-lg text-white">{points} 分</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line-fine)] py-3">
                <dt className="text-sm text-white/60">兌換後剩</dt>
                <dd className="text-right">
                  <span
                    className={`stat-figure text-lg ${
                      shortfall > 0 ? "text-red-400" : "text-white"
                    }`}
                  >
                    {remainingAfter} 分
                  </span>
                  {shortfall > 0 && (
                    <span className="ml-2 text-xs text-red-300">
                      差 {shortfall} 分
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line-fine)] py-3">
                <dt className="text-sm text-white/60">每人限換</dt>
                <dd className="text-right text-sm text-white/85">
                  {reward.per_user_limit === null
                    ? "不限"
                    : `${reward.per_user_limit} 件${
                        reward.redeemed_count > 0
                          ? `（你已換 ${reward.redeemed_count} 件）`
                          : "（你未換過）"
                      }`}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4 py-3">
                <dt className="shrink-0 text-sm text-white/60">去邊度攞</dt>
                <dd className="text-right text-sm text-white/85">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <MapPin size={14} className="text-vital-bright" />
                    {reward.merchant_name ?? "核銷商戶資料更新中"}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-white/55">
                    出示 QR 碼或領取碼，由店員即場核銷
                  </span>
                </dd>
              </div>
            </dl>

            <div className="mt-2 text-xs text-white/50">
              庫存：
              {reward.stock_remaining === null
                ? "不限量（電子券）"
                : soldOut
                  ? "已換完"
                  : `剩 ${reward.stock_remaining} 件`}
            </div>

            <p className="mt-4 text-sm leading-relaxed text-white/70">
              你現時有{" "}
              <span className="stat-figure text-base text-white">{points}</span>{" "}
              分，兌換後剩{" "}
              <span
                className={`stat-figure text-base ${
                  shortfall > 0 ? "text-red-400" : "text-white"
                }`}
              >
                {remainingAfter}
              </span>{" "}
              分。
            </p>

            {/* 新會員要在「事前」看到，不是換完才說 */}
            {newMember && (
              <div className="slab mt-6 flex items-start gap-2.5 border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-100">
                <ShieldCheck size={17} className="mt-0.5 flex-none" />
                <span>
                  你的帳號未滿 7 日，兌換需管理員確認（約 1 個工作天）。積分會即時扣除，確認後券才生效。
                </span>
              </div>
            )}

            <div className="mt-6">
              <RedeemPanel
                rewardId={reward.id}
                rewardName={reward.name}
                pointsCost={cost}
                points={points}
                remainingAfter={remainingAfter}
                merchantName={reward.merchant_name}
                perUserLimit={reward.per_user_limit}
                redeemedCount={reward.redeemed_count}
                isNewMember={newMember}
                disabledReason={disabledReason}
              />
            </div>

            {shortfall > 0 && (
              <div className="mt-4 text-center text-xs leading-relaxed text-white/60">
                還差 {shortfall} 分。
                <Link
                  href="/run"
                  className="mx-1 font-semibold text-accent-blue underline underline-offset-4"
                >
                  上傳跑步紀錄
                </Link>
                或
                <Link
                  href="/training"
                  className="mx-1 font-semibold text-accent-blue underline underline-offset-4"
                >
                  報名訓練
                </Link>
                都可以賺分。
              </div>
            )}

            <p className="mt-4 text-center text-[11px] text-white/40">
              兌換按鈕只在這件禮品可兌換時才可按下；實際扣分與庫存以系統紀錄為準。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
