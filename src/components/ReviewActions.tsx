"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as { ok: boolean; error?: string; message?: string };
}

/** 跑步提交審核（通過 / 駁回） */
export function RunReviewActions({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function act(approve: boolean) {
    setPending(approve ? "approve" : "reject");
    setError(null);
    try {
      const data = await post("/api/admin/review-run", {
        submission_id: submissionId,
        approve,
        admin_note: note,
      });
      if (!data.ok) {
        setError(data.error ?? "操作失敗。");
        return;
      }
      setNote("");
      router.refresh();
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="備註（選填，駁回時建議填原因）"
        className="field min-w-[200px] flex-1 !py-2 text-sm"
      />
      <button
        type="button"
        disabled={pending !== null}
        onClick={() => act(true)}
        className="btn-base btn-cobalt !px-5 !py-2 text-sm"
      >
        {pending === "approve" ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Check size={16} />
        )}{" "}
        通過
      </button>
      <button
        type="button"
        disabled={pending !== null}
        onClick={() => act(false)}
        className="btn-base btn-ghost !px-5 !py-2 text-sm hover:!border-red-500 hover:!bg-red-500/10 hover:!text-red-300"
      >
        {pending === "reject" ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <X size={16} />
        )}{" "}
        駁回
      </button>
      {error && <p className="w-full text-xs text-red-300">{error}</p>}
    </div>
  );
}

/** 訓練簽到確認（確認 / 駁回） */
export function CheckinReviewActions({ checkinId }: { checkinId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function act(approve: boolean) {
    setPending(approve ? "approve" : "reject");
    setError(null);
    try {
      const data = await post("/api/admin/review-checkin", {
        checkin_id: checkinId,
        approve,
        admin_note: note,
      });
      if (!data.ok) {
        setError(data.error ?? "操作失敗。");
        return;
      }
      setNote("");
      router.refresh();
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="備註（選填）"
        className="field min-w-[180px] flex-1 !py-2 text-sm"
      />
      <button
        type="button"
        disabled={pending !== null}
        onClick={() => act(true)}
        className="btn-base btn-cobalt !px-5 !py-2 text-sm"
      >
        {pending === "approve" ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Check size={16} />
        )}{" "}
        確認
      </button>
      <button
        type="button"
        disabled={pending !== null}
        onClick={() => act(false)}
        className="btn-base btn-ghost !px-5 !py-2 text-sm hover:!border-red-500 hover:!bg-red-500/10 hover:!text-red-300"
      >
        {pending === "reject" ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <X size={16} />
        )}{" "}
        駁回
      </button>
      {error && <p className="w-full text-xs text-red-300">{error}</p>}
    </div>
  );
}
