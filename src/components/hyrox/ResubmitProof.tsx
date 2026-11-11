"use client";

/**
 * src/components/hyrox/ResubmitProof.tsx — 付款被拒絕後重新上傳轉帳證明
 *
 * 只在 payment_status='rejected' 時出現。上傳成功才可按「重新提交」，
 * 送出 POST /api/hyrox/resubmit-proof {registration_id, proof_path}。
 * 成功後用 router.refresh() 讓 Server Component 重新取狀態（不假造本地狀態）。
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, Send } from "lucide-react";
import { ProofUploader } from "./ProofUploader";
import { postHyrox } from "./api";

export function ResubmitProof({ registrationId }: { registrationId: string }) {
  const router = useRouter();
  const [proofPath, setProofPath] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!proofPath) return;
    setPending(true);
    setError(null);

    const res = await postHyrox<{ registration?: { id: string } }>(
      "/api/hyrox/resubmit-proof",
      { registration_id: registrationId, proof_path: proofPath }
    );

    if (res.ok) {
      setDone(true);
      router.refresh();
    } else {
      setError(res.error);
    }
    setPending(false);
  }

  if (done) {
    return (
      <div className="mt-4 flex items-start gap-2 border-l-2 border-emerald-500/60 bg-emerald-500/10 px-4 py-3">
        <CheckCircle2 size={16} className="mt-0.5 flex-none text-emerald-300" />
        <p className="min-w-0 break-words text-sm leading-relaxed text-emerald-200">
          已重新提交，等管理員再次核對。
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-[var(--line-fine)] pt-4">
      <h3 className="text-sm font-bold text-white/85">重新上傳轉帳證明</h3>
      <p className="mt-1 break-words text-xs leading-relaxed text-white/55">
        可上載 1 個檔案，大小上限為 10 MB。請確認截圖看得到金額與時間。
      </p>

      <div className="mt-3">
        <label className="label" htmlFor="hyrox-proof">
          轉帳證明上傳
        </label>
        <ProofUploader
          value={proofPath}
          onChange={setProofPath}
          disabled={pending}
        />
      </div>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="mt-3 flex items-start gap-2 border-l-2 border-red-500/60 bg-red-500/10 px-4 py-3"
        >
          <AlertCircle size={16} className="mt-0.5 flex-none text-red-300" />
          <p className="min-w-0 break-words text-sm leading-relaxed text-red-200">
            {error}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!proofPath || pending}
        className="btn-base btn-vital btn-slab mt-3 min-h-11 w-full disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        {pending ? (
          <>
            <Loader2 size={16} className="animate-spin" /> 提交中…
          </>
        ) : (
          <>
            <Send size={16} /> 重新提交
          </>
        )}
      </button>
    </div>
  );
}
