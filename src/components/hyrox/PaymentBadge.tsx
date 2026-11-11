/**
 * src/components/hyrox/PaymentBadge.tsx — 付款狀態徽章（前台／後台共用）
 *
 * 口徑集中在 shared.ts 的 PAYMENT_META，避免首頁、報名頁、後台三處
 * 各寫一套「待確認／已確認／已拒絕」而文案不一致。
 */

import type { PaymentStatus } from "@/lib/types";
import { PAYMENT_META } from "./shared";

export function PaymentBadge({
  status,
  size = "md",
  className = "",
}: {
  status: PaymentStatus;
  size?: "sm" | "md";
  className?: string;
}) {
  const meta = PAYMENT_META[status] ?? PAYMENT_META.not_required;
  const pad = size === "sm" ? "px-2.5 py-0.5 text-[11px]" : "px-3 py-1 text-xs";
  return (
    <span
      className={`slab inline-flex items-center gap-1.5 border font-bold tracking-[0.04em] ${meta.className} ${pad} ${className}`}
    >
      {meta.label}
    </span>
  );
}
