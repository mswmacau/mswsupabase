"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, TicketCheck } from "lucide-react";

export function RedeemForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit() {
    if (!code.trim()) {
      setError("請輸入優惠券代碼。");
      return;
    }
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/coupons", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; message?: string };
      if (!data.ok) {
        setError(data.error ?? "核銷失敗。");
        return;
      }
      setSuccess(data.message ?? "核銷成功。");
      setCode("");
      router.refresh();
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className="label" htmlFor="code">
            輸入會員出示的優惠券代碼
          </label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="MSW-202609-A1B2C3"
            className="field font-mono uppercase"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="btn-base btn-cobalt"
        >
          {pending ? (
            <>
              <Loader2 size={17} className="animate-spin" /> 核銷中…
            </>
          ) : (
            <>
              <TicketCheck size={17} /> 核銷
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}
    </div>
  );
}
