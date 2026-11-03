import QRCode from "qrcode";
import { CheckCircle2, Clock, Gift, Lock, XCircle } from "lucide-react";
import { CopyCodeButton } from "./CopyCodeButton";
import { formatDate, formatDateTime } from "@/lib/utils";
import {
  REDEMPTION_STATUS_LABEL,
  groupPickupCode,
  isRedemptionExpired,
  type RedemptionRow,
} from "@/lib/rewards";

/**
 * QR 用標準黑白輸出（白底黑碼）：店員手機在室內燈光下辨識率最高，
 * 刻意不跟深色主題改色。margin=2 保留 quiet zone。
 * 顯示尺寸 160px（約 4.2cm），符合「≥2cm 可掃」。
 */
async function buildQrSvg(code: string): Promise<string> {
  return QRCode.toString(code, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320,
  });
}

const CHIP: Record<string, string> = {
  pending: "border-vital/50 bg-vital/10 text-vital-bright",
  pending_approval: "border-amber-500/45 bg-amber-500/10 text-amber-200",
  completed: "border-emerald-500/45 bg-emerald-500/10 text-emerald-300",
  cancelled: "border-white/20 bg-white/5 text-white/60",
  expired: "border-white/20 bg-white/5 text-white/60",
};

export async function RedemptionCard({
  item,
  highlight = false,
}: {
  item: RedemptionRow;
  highlight?: boolean;
}) {
  const expired = isRedemptionExpired(item.status, item.expires_at);
  const state = expired ? "expired" : item.status;
  const usable = state === "pending";
  const pendingApproval = state === "pending_approval";
  const showQr = (usable || pendingApproval) && Boolean(item.pickup_code);
  const qrSvg = usable && item.pickup_code ? await buildQrSvg(item.pickup_code) : "";

  const chipLabel = expired ? "已過期" : REDEMPTION_STATUS_LABEL[item.status];
  const codeText = groupPickupCode(item.pickup_code);

  return (
    <article
      className={`clip-notch-br relative overflow-hidden border p-5 transition ${
        highlight
          ? "border-vital ring-2 ring-vital/60 bg-gradient-to-br from-vital/12 via-ink-soft to-ink-soft"
          : usable
            ? "border-[var(--line-fine)] bg-gradient-to-br from-vital/8 via-ink-soft to-ink-soft"
            : "border-ink-line bg-ink-soft"
      }`}
    >
      {highlight && (
        <span className="slab absolute right-4 top-4 border border-vital/60 bg-vital px-2 py-0.5 text-[10px] font-black tracking-[0.14em] text-white">
          新兌換
        </span>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] text-white/45">
            <Gift size={13} /> Redemption
          </div>
          <h3 className={`mt-1.5 text-base font-bold ${highlight ? "pr-16" : ""}`}>
            {item.reward_name}
          </h3>
        </div>
        {!highlight && (
          <span
            className={`slab inline-flex flex-none items-center border px-2.5 py-1 text-[11px] font-semibold ${CHIP[state]}`}
          >
            {chipLabel}
          </span>
        )}
      </div>

      {/* 狀態說明：一句話講清楚「錢扣了沒有、券能不能用」 */}
      <p
        className={`mt-2 flex items-start gap-1.5 text-xs leading-relaxed ${
          state === "completed"
            ? "text-emerald-300"
            : state === "pending_approval"
              ? "text-amber-200"
              : state === "expired" || state === "cancelled"
                ? "text-white/55"
                : "text-white/65"
        }`}
      >
        {state === "completed" ? (
          <>
            <CheckCircle2 size={14} className="mt-0.5 flex-none" />
            {`已於 ${formatDateTime(
              item.merchant_verified_at ?? item.decided_at ?? item.created_at
            )} 領取`}
          </>
        ) : state === "pending_approval" ? (
          <>
            <Clock size={14} className="mt-0.5 flex-none" />
            等管理員確認，積分已扣；確認後 QR 才可核銷
          </>
        ) : state === "expired" ? (
          <>
            <XCircle size={14} className="mt-0.5 flex-none" />
            {`已於 ${formatDate(item.expires_at)} 過期，未領取`}
          </>
        ) : state === "cancelled" ? (
          <>
            <XCircle size={14} className="mt-0.5 flex-none" />
            已取消，積分已退回
          </>
        ) : (
          <>
            <Clock size={14} className="mt-0.5 flex-none" />
            出示 QR 或券碼，由店員核銷
          </>
        )}
      </p>

      {showQr && item.pickup_code && (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className={`relative flex-none self-start p-3 ${usable ? "bg-white" : "border border-dashed border-white/15"}`}>
            {usable ? (
              <div
                role="img"
                aria-label={`領取碼 ${codeText} 的 QR Code`}
                className="h-40 w-40 [&_svg]:h-full [&_svg]:w-full"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            ) : (
              <div className="flex h-40 w-40 flex-col items-center justify-center gap-2 bg-paper px-3 text-center text-[11px] font-semibold leading-relaxed text-ink/70">
                <Lock size={20} />
                未生效
                <span className="font-normal">待管理員確認後才顯示 QR</span>
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.22em] text-white/45">
              領取碼
            </div>
            <div className="stat-figure mt-1 select-all break-all font-mono text-xl tracking-[0.08em] text-white">
              {codeText || "—"}
            </div>
            <div className="mt-3">
              <CopyCodeButton code={item.pickup_code} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/45">
              掃不到碼時，店員可人手輸入上面 12 位券碼。
            </p>
          </div>
        </div>
      )}

      <dl className="mt-4 border-t border-[var(--line-fine)] pt-3 text-xs">
        <div className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-white/50">核銷商戶</dt>
          <dd className="text-right text-white/85">
            {item.merchant_name ?? "商戶資料更新中"}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-white/50">兌換日期</dt>
          <dd className="stat-figure text-white/85">{formatDate(item.created_at)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-white/50">兌換積分</dt>
          <dd className="stat-figure text-white/85">-{item.points_spent} 分</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-white/50">有效至</dt>
          <dd className="stat-figure text-white/85">
            {item.expires_at ? formatDate(item.expires_at) : "不設期限"}
          </dd>
        </div>
      </dl>
    </article>
  );
}
