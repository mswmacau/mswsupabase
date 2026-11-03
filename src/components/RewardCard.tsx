import Link from "next/link";
import { Gift, MapPin } from "lucide-react";
import { publicAssetUrl } from "@/lib/assets";
import type { RewardCardData } from "@/lib/rewards";

/**
 * 禮品卡：整張卡可撳入詳情。
 * 庫存／積分價一律用 DB 回傳值，這裡只負責顯示與狀態文案。
 */
export function RewardCard({
  reward,
  points,
}: {
  reward: RewardCardData;
  points: number;
}) {
  const image = publicAssetUrl(reward.image_path);
  const soldOut = reward.stock_remaining !== null && reward.stock_remaining <= 0;
  const hitLimit =
    reward.per_user_limit !== null && reward.redeemed_count >= reward.per_user_limit;
  const shortfall = reward.points_cost - points;
  const affordable = shortfall <= 0;
  const redeemable = affordable && !soldOut && !hitLimit;

  const stockText =
    reward.stock_remaining === null
      ? "不限量"
      : soldOut
        ? "已換完"
        : `剩 ${reward.stock_remaining} 件`;

  const badge = soldOut
    ? "已換完"
    : hitLimit
      ? "已達上限"
      : !affordable
        ? `差 ${shortfall} 分`
        : null;

  return (
    <Link
      href={`/dashboard/rewards/${reward.id}`}
      aria-label={`${reward.name}，${reward.points_cost} 分${
        redeemable ? "，可兌換" : badge ? `，${badge}` : ""
      }`}
      className={`clip-notch-br group relative flex flex-col overflow-hidden border bg-ink-soft transition ${
        redeemable
          ? "border-[var(--line-fine)] hover:border-vital/50"
          : "border-ink-line opacity-80 hover:opacity-100"
      }`}
    >
      {/* 圖：DB 未上傳圖片時用品牌色塊，不留白爛版位 */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-gradient-to-br from-cobalt/35 via-ink-soft to-ink">
        <div className="hero-grid absolute inset-0 opacity-25" />
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={reward.name}
            loading="lazy"
            decoding="async"
            className={`h-full w-full object-cover transition duration-500 group-hover:scale-[1.03] ${
              redeemable ? "" : "opacity-60 saturate-50"
            }`}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Gift
              size={44}
              className={redeemable ? "text-vital-bright/80" : "text-white/35"}
            />
          </div>
        )}

        {badge && (
          <span className="slab absolute left-3 top-3 border border-white/25 bg-black/65 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
            {badge}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-2 text-base font-bold leading-snug text-white">
          {reward.name}
        </h3>

        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="stat-figure text-2xl text-vital-bright">
            {reward.points_cost}
          </span>
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-white/55">
            分
          </span>
          <span className="text-xs text-white/45">·</span>
          <span
            className={`text-xs font-semibold ${
              soldOut ? "text-red-300" : "text-white/70"
            }`}
          >
            {stockText}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-1.5 text-xs text-white/60">
          <MapPin size={13} className="flex-none text-white/40" />
          <span className="truncate">
            {reward.merchant_name ?? "核銷商戶資料更新中"}
          </span>
        </div>

        <div className="mt-auto pt-3 text-[11px] text-white/50">
          {reward.per_user_limit === null
            ? "不限每人兌換次數"
            : `每人限換 ${reward.per_user_limit} 件${
                reward.redeemed_count > 0 ? `（你已換 ${reward.redeemed_count} 件）` : ""
              }`}
        </div>
      </div>
    </Link>
  );
}
