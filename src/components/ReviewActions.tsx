"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as { ok: boolean; error?: string; message?: string };
}

/**
 * 跑步提交審核（通過 / 駁回）
 *
 * P1-1 防誤按：核准是**不可逆**的寫入 —— 里程立即加進會員的 total_km、
 * 積分立即入帳，可能還觸發月度達標自動發券（見 /api/admin/review-run）。
 * 原本一按就走，實測真的被誤按過，所以這裡補一層二次確認，
 * 並在確認框裡把「會加多少 km / 多少分」寫出來，讓管理員按之前就知道後果。
 *
 * 駁回不需要確認：它不改里程、不加分，錯了再改回來成本極低，
 * 加確認只會讓每天要按幾十次的操作變慢。
 *
 * pointsPerKm 由 server 端讀 app_settings 傳進來（後台可調），
 * 不在前端寫死 1 —— 否則確認框顯示的分數會與實際加分不符。
 */
export function RunReviewActions({
  submissionId,
  km,
  pointsPerKm = 1,
}: {
  submissionId: string;
  km: number;
  pointsPerKm?: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const points = Math.round((Number(km) || 0) * (pointsPerKm || 0));

  /* Esc 關閉確認框；只監聽「確認框開著」的期間，關掉就移除監聽 */
  useEffect(() => {
    if (!confirming) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && pending === null) setConfirming(false);
    }

    window.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirming, pending]);

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
        onClick={() => setConfirming(true)}
        data-testid="run-approve"
        className="btn-base btn-cobalt min-h-11 !px-5 !py-2 text-sm sm:min-h-9"
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
        className="btn-base btn-ghost min-h-11 !px-5 !py-2 text-sm hover:!border-red-500 hover:!bg-red-500/10 hover:!text-red-300 sm:min-h-9"
      >
        {pending === "reject" ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <X size={16} />
        )}{" "}
        駁回
      </button>
      {error && <p className="w-full text-xs text-red-300">{error}</p>}

      {/* ===== 二次確認 ===== */}
      {confirming && (
        <div
          className="fixed inset-0 z-[85] flex items-end justify-center overflow-y-auto bg-ink/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && pending === null) {
              setConfirming(false);
            }
          }}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`approve-confirm-title-${submissionId}`}
            aria-describedby={`approve-confirm-desc-${submissionId}`}
            tabIndex={-1}
            data-testid="approve-confirm"
            className="w-full max-w-md rounded-t-2xl border border-ink-line bg-ink-soft p-5 sm:rounded-xl sm:p-6"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-300" />
              <h3
                id={`approve-confirm-title-${submissionId}`}
                className="min-w-0 flex-1 text-base font-bold"
              >
                確認核准這筆跑步紀錄？
              </h3>
            </div>

            <p
              id={`approve-confirm-desc-${submissionId}`}
              className="mt-3 text-sm leading-relaxed text-white/80"
            >
              核准後會立即增加{" "}
              <strong className="font-bold text-blue-300">{km} km</strong> 與{" "}
              <strong className="font-bold text-blue-300">{points} 分</strong>
              （該月滿 300 公里會再加 200 分並發券）。
              按下去無法直接還原，需要到會員管理用「更正總里程」修正。確定核准？
            </p>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending !== null}
                className="btn-base btn-ghost min-h-11 md:min-h-0"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  void act(true);
                }}
                disabled={pending !== null}
                data-testid="approve-confirm-ok"
                className="btn-base btn-cobalt min-h-11 md:min-h-0"
              >
                確定核准
              </button>
            </div>
          </div>
        </div>
      )}
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
        className="btn-base btn-cobalt min-h-11 !px-5 !py-2 text-sm sm:min-h-9"
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
        className="btn-base btn-ghost min-h-11 !px-5 !py-2 text-sm hover:!border-red-500 hover:!bg-red-500/10 hover:!text-red-300 sm:min-h-9"
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
