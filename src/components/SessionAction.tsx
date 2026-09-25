"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { RULES } from "@/lib/config";

/** 訓練場次的報名／取消按鈕 */
export function SessionAction({
  sessionId,
  myStatus,
  isLoggedIn,
  sessionStatus,
}: {
  sessionId: string;
  myStatus: string | null;
  isLoggedIn: boolean;
  sessionStatus: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "join" | "leave") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/training/checkins", {
        method: action === "join" ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "操作失敗。");
        return;
      }
      router.refresh();
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setPending(false);
    }
  }

  if (!isLoggedIn) {
    return (
      <Link href="/login?next=/training" className="btn-base btn-cobalt w-full text-sm">
        登入後報名
      </Link>
    );
  }

  if (myStatus) {
    return (
      <div className="space-y-2">
        <div
          className={`flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold ${
            myStatus === "approved"
              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
              : myStatus === "rejected"
                ? "border-red-500/40 bg-red-500/15 text-red-300"
                : "border-amber-500/40 bg-amber-500/15 text-amber-300"
          }`}
        >
          {myStatus === "approved" ? (
            <>
              <Check size={16} /> 已確認（+{RULES.CHECKIN_POINTS} 分）
            </>
          ) : myStatus === "rejected" ? (
            "已駁回"
          ) : (
            "已報名 · 待確認"
          )}
        </div>

        {myStatus === "pending" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => act("leave")}
            className="w-full text-center text-xs text-white/45 transition hover:text-red-300 disabled:opacity-50"
          >
            {pending ? "處理中…" : "取消報名"}
          </button>
        )}
        {error && <p className="text-center text-xs text-red-300">{error}</p>}
      </div>
    );
  }

  if (sessionStatus !== "open") {
    return (
      <button disabled className="btn-base btn-ghost w-full text-sm">
        報名已截止
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => act("join")}
        className="btn-base btn-vital w-full text-sm"
      >
        {pending ? (
          <>
            <Loader2 size={16} className="animate-spin" /> 處理中…
          </>
        ) : (
          "報名這一場"
        )}
      </button>
      {error && <p className="text-center text-xs text-red-300">{error}</p>}
    </div>
  );
}
