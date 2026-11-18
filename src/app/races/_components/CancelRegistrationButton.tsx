"use client";

/**
 * src/app/races/_components/CancelRegistrationButton.tsx — 會員取消賽事報名
 *
 * 為什麼是獨立 client 元件：會員中心（src/app/dashboard/page.tsx）是 Server
 * Component，只有「取消」這一個動作需要互動，抽出來可以讓整張卡維持 server 渲染
 * （取消後用 router.refresh() 讓 server 重新取資料，不需要把清單搬到 client）。
 *
 * 契約：DELETE /api/races/[id]/registrations → 200 { ok:true, message, status }
 *   失敗 → { ok:false, error, code }（例如賽事已截止時回 409，會員端 RLS 不允許取消）
 *   已取消再打一次是冪等 200。
 *
 * 二次確認用行內展開而不是 window.confirm：手機上原生彈窗文案不可控、
 * 也無法說明「取消後要聯絡教練才能恢復」。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";

type Props = {
  eventId: string;
  /** 只用在確認文案與錯誤訊息裡，讓會員知道自己在取消哪一場 */
  eventTitle: string;
};

export function CancelRegistrationButton({ eventId, eventTitle }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 卸載（含刷新後元件被換掉）時取消在途請求，避免對已卸載元件 setState
  useEffect(() => () => abortRef.current?.abort(), []);

  const onCancel = useCallback(async () => {
    setBusy(true);
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(`/api/races/${eventId}/registrations`, {
        method: "DELETE",
        signal: ac.signal,
      });
      const json: unknown = await res.json().catch(() => null);
      const ok =
        typeof json === "object" &&
        json !== null &&
        (json as { ok?: unknown }).ok === true;

      if (!res.ok || !ok) {
        const message =
          typeof json === "object" && json !== null
            ? String((json as { error?: unknown }).error ?? "")
            : "";
        setError(message || "取消失敗，請稍後再試。");
        return;
      }

      setConfirming(false);
      // 清單由 server component 讀取 → 刷新即見「已取消」
      router.refresh();
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setError("網絡不穩，取消失敗，請重試。");
    } finally {
      setBusy(false);
    }
  }, [eventId, router]);

  if (!confirming) {
    return (
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className="btn-base btn-ghost btn-slab min-h-11 px-4 text-sm text-red-300"
        >
          取消報名
        </button>
        {error && (
          <p
            role="alert"
            className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-red-300"
          >
            <AlertCircle size={13} aria-hidden className="mt-0.5 flex-shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0 border border-red-500/40 bg-red-500/[0.08] px-3.5 py-3">
      <p className="break-words text-sm leading-relaxed text-red-100">
        確定取消「{eventTitle}」的報名？取消後如需恢復要聯絡教練。
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onCancel()}
          disabled={busy}
          className="btn-base btn-vital btn-slab min-h-11 px-4 text-sm"
        >
          {busy ? (
            <>
              <Loader2 size={14} aria-hidden className="animate-spin" />
              取消中…
            </>
          ) : (
            "確定取消"
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={busy}
          className="btn-base btn-ghost btn-slab min-h-11 px-4 text-sm"
        >
          返回
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-red-300"
        >
          <AlertCircle size={13} aria-hidden className="mt-0.5 flex-shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </p>
      )}
    </div>
  );
}
