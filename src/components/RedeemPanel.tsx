"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react";

/** UUID v4：優先用原生 randomUUID（HTTPS／localhost），否則用 getRandomValues 手組 */
function uuidV4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

interface Props {
  rewardId: string;
  rewardName: string;
  pointsCost: number;
  points: number;
  remainingAfter: number;
  merchantName: string | null;
  perUserLimit: number | null;
  redeemedCount: number;
  isNewMember: boolean;
  /** 非 null 時按鈕停用，內容為停用原因 */
  disabledReason: string | null;
}

/**
 * 兌換按鈕 + 二次確認對話框。
 *
 * 防連點：按下確認即 disable，並在整個請求期間保持 disable；
 * 冪等鍵在「開啟對話框」時產生一次，重試沿用同一把 key（RPC 會回原結果，不會重扣）。
 */
export function RedeemPanel({
  rewardId,
  rewardName,
  pointsCost,
  points,
  remainingAfter,
  merchantName,
  perUserLimit,
  redeemedCount,
  isNewMember,
  disabledReason,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string>("");
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  function openDialog() {
    keyRef.current = uuidV4();
    setError(null);
    setPending(false);
    setOpen(true);
  }

  // Esc 關閉 + 鎖背景捲動；只在開啟時掛載監聽
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, pending]);

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/rewards/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reward_id: rewardId,
          idempotency_key: keyRef.current,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        code?: string | null;
        status?: string | null;
      };

      if (!data.ok) {
        setError(data.error ?? "兌換失敗，請稍後再試。");
        setPending(false);
        return;
      }

      const pickup = data.code ? `?new=${encodeURIComponent(data.code)}` : "";
      router.push(`/dashboard/redemptions${pickup}`);
      router.refresh();
    } catch {
      setError("網絡不穩，兌換未完成。請再按一次確認（不會重複扣分）。");
      setPending(false);
    }
  }

  const limitLine =
    perUserLimit === null
      ? "不限每人兌換次數"
      : `每人限換 ${perUserLimit} 件，這是第 ${redeemedCount + 1} 件`;

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        disabled={disabledReason !== null}
        className={`btn-base btn-slab min-h-12 w-full text-base ${
          disabledReason !== null
            ? "cursor-not-allowed border border-white/15 bg-white/[0.04] text-white/45"
            : "btn-vital"
        }`}
      >
        {disabledReason ?? `確認兌換 · ${pointsCost} 分`}
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/75 p-4 backdrop-blur-sm sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="redeem-title"
            className="clip-notch-br max-h-[90dvh] w-full max-w-md overflow-y-auto border border-white/15 bg-ink-soft p-6 shadow-2xl"
          >
            <h2 id="redeem-title" className="text-xl font-black tracking-tight">
              確認兌換？
            </h2>

            <dl className="mt-5 space-y-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line-fine)] pb-2.5">
                <dt className="text-white/60">禮品</dt>
                <dd className="text-right font-semibold text-white">
                  {rewardName} × 1
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line-fine)] pb-2.5">
                <dt className="text-white/60">扣分</dt>
                <dd className="stat-figure text-right text-lg text-red-400">
                  -{pointsCost}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line-fine)] pb-2.5">
                <dt className="text-white/60">兌換後剩</dt>
                <dd className="stat-figure text-right text-lg text-white">
                  {remainingAfter} 分
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line-fine)] pb-2.5">
                <dt className="text-white/60">每人限額</dt>
                <dd className="text-right text-white/85">{limitLine}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-white/60">去邊度攞</dt>
                <dd className="text-right text-white/85">
                  {merchantName ?? "核銷商戶"}
                  <span className="mt-1 block text-xs text-white/55">
                    出示 QR 碼或領取碼，由店員核銷
                  </span>
                </dd>
              </div>
            </dl>

            <p className="mt-4 text-xs leading-relaxed text-white/55">
              兌換後即時扣分。如需取消，請聯絡我們。
            </p>

            {isNewMember && (
              <p className="slab mt-4 flex items-start gap-2 border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-100">
                <ShieldCheck size={15} className="mt-0.5 flex-none" />
                <span>
                  你的帳號未滿 7 日，兌換需管理員確認（約 1 個工作天）。積分會即時扣除，確認後券才生效。
                </span>
              </p>
            )}

            {error && (
              <p
                role="alert"
                aria-live="polite"
                className="slab mt-4 flex items-start gap-2 border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs leading-relaxed text-red-200"
              >
                <AlertCircle size={15} className="mt-0.5 flex-none" />
                <span>{error}</span>
              </p>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                className="btn-base btn-vital btn-slab min-h-12 flex-1 disabled:cursor-not-allowed"
              >
                {pending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> 兌換中…
                  </>
                ) : (
                  "確認兌換"
                )}
              </button>
              <button
                ref={cancelRef}
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="btn-base btn-ghost btn-slab min-h-12 flex-1"
              >
                再想想
              </button>
            </div>

            <p className="mt-3 text-center text-[11px] text-white/40">
              現時積分 {points} 分
            </p>
          </div>
        </div>
      )}
    </>
  );
}
