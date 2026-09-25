import QRCode from "qrcode";
import { CheckCircle2, Ticket } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { formatDate } from "@/lib/utils";
import type { Coupon } from "@/lib/types";

/** 優惠券卡片：含 QR Code（伺服端產生 dataURL） */
export async function CouponCard({ coupon }: { coupon: Coupon }) {
  const expired =
    coupon.expires_at &&
    new Date(coupon.expires_at).getTime() < Date.now() &&
    coupon.status === "active";

  const status = expired ? "expired" : coupon.status;

  const qr = await QRCode.toDataURL(coupon.code, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 300,
    color: { dark: "#0F0F0F", light: "#FFFFFF" },
  });

  const usable = status === "active";

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-6 transition ${
        usable
          ? "border-vital/50 bg-gradient-to-br from-vital/15 via-ink-soft to-ink-soft"
          : "border-ink-line bg-ink-soft opacity-70"
      }`}
    >
      {/* 票券打孔裝飾 */}
      <span className="absolute -left-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-ink" />
      <span className="absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-ink" />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-vital">
            <Ticket size={14} /> MSW Coupon
          </div>
          <h3 className="mt-2 truncate text-lg font-bold">{coupon.title}</h3>
          {coupon.month_awarded && (
            <div className="mt-0.5 text-xs text-white/45">
              來自 {coupon.month_awarded} 月度任務
            </div>
          )}
        </div>
        <StatusBadge status={status} />
      </div>

      {coupon.description && (
        <p className="mt-4 text-sm leading-relaxed text-white/60">
          {coupon.description}
        </p>
      )}

      <div className="mt-6 flex flex-col items-center gap-5 sm:flex-row sm:items-end">
        <div className="rounded-xl bg-white p-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qr}
            alt={`優惠券 ${coupon.code} 的 QR Code`}
            className="h-32 w-32"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-[0.18em] text-white/40">
            優惠券代碼
          </div>
          <div className="mt-1 select-all break-all font-mono text-xl font-bold tracking-wide">
            {coupon.code}
          </div>
          <div className="mt-3 space-y-1 text-xs text-white/45">
            <div>有效期限：{coupon.expires_at ? formatDate(coupon.expires_at) : "無期限"}</div>
            {coupon.redeemed_at && (
              <div className="flex items-center gap-1 text-emerald-300">
                <CheckCircle2 size={13} /> 已於 {formatDate(coupon.redeemed_at)} 使用
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
