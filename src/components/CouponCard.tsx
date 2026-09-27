import QRCode from "qrcode";
import { CheckCircle2, Ticket } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { formatDate } from "@/lib/utils";
import type { Coupon } from "@/lib/types";

/**
 * 到期判定（一般函式，非 component／hook）。
 * 到期是相對於「本次請求當下」的快照，放在這裡可讓 component render 保持可預測。
 */
function resolveStatus(coupon: Coupon): Coupon["status"] | "expired" {
  if (coupon.status !== "active") return coupon.status;
  if (!coupon.expires_at) return coupon.status;
  return new Date(coupon.expires_at).getTime() < Date.now() ? "expired" : coupon.status;
}

/**
 * QR Code 改以 inline SVG 輸出，顏色由 CSS 變數驅動：
 *  - 模組 → currentColor（外層用 --color-ink）
 *  - 底色 → 移除，交給外層容器用 --color-white
 * 這樣後台換品牌色時 QR 會跟著變，不再有硬編碼 hex。
 */
async function buildQrSvg(code: string): Promise<string> {
  const raw = await QRCode.toString(code, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 300,
  });

  return (
    raw
      // 底色移除：由外層容器的 CSS 變數決定
      .replace(/<path[^>]*fill="#ffffff"[^>]*\/>/g, "")
      // 模組改用 currentColor
      .replace(/stroke="#000000"/g, 'stroke="currentColor"')
  );
}

/** 優惠券卡片：斜切角 + QR 區層次化 */
export async function CouponCard({ coupon }: { coupon: Coupon }) {
  const status = resolveStatus(coupon);
  const qrSvg = await buildQrSvg(coupon.code);

  const usable = status === "active";

  return (
    <div
      className={`clip-notch-br relative overflow-hidden border p-6 transition ${
        usable
          ? "z-raise border-vital/50 bg-gradient-to-br from-vital/15 via-ink-soft to-ink-soft"
          : "border-ink-line bg-ink-soft opacity-70"
      }`}
    >
      {/* 票券打孔裝飾 */}
      <span className="absolute -left-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-ink" />
      <span className="absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-ink" />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-vital-bright">
            <Ticket size={14} /> MSW Coupon
          </div>
          <h3 className="mt-2 truncate text-lg font-bold">{coupon.title}</h3>
          {coupon.month_awarded && (
            <div className="mt-0.5 text-xs text-white/60">
              來自 {coupon.month_awarded} 月度任務
            </div>
          )}
        </div>
        <StatusBadge status={status} />
      </div>

      {coupon.description && (
        <p className="mt-4 text-sm leading-relaxed text-white/75">
          {coupon.description}
        </p>
      )}

      {/* ===== QR 區：層次化（底盤 → 券碼 → 明細） ===== */}
      <div className="mt-6 flex flex-col gap-5 sm:flex-row">
        <div
          className="clip-slab flex-none self-start p-3"
          style={{
            background: "var(--color-white)",
            color: "var(--color-ink)",
          }}
        >
          <div
            role="img"
            aria-label={`優惠券 ${coupon.code} 的 QR Code`}
            className="h-32 w-32 [&_svg]:h-full [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        </div>

        <div className="min-w-0 flex-1 border-t border-[var(--line-fine)] pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
          <div className="text-[11px] uppercase tracking-[0.22em] text-white/55">
            優惠券代碼
          </div>
          <div className="stat-figure mt-1.5 select-all break-all font-mono text-2xl text-white">
            {coupon.code}
          </div>

          <dl className="mt-4">
            <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line-fine)] py-2">
              <dt className="text-xs text-white/60">有效期限</dt>
              <dd className="stat-figure text-xs text-white/85">
                {coupon.expires_at ? formatDate(coupon.expires_at) : "無期限"}
              </dd>
            </div>
            {coupon.redeemed_at && (
              <div className="flex items-baseline justify-between gap-4 py-2">
                <dt className="text-xs text-white/60">核銷狀態</dt>
                <dd className="flex items-center gap-1 text-xs text-emerald-300">
                  <CheckCircle2 size={13} /> 已於 {formatDate(coupon.redeemed_at)} 使用
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
