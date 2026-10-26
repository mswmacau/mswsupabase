"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Mail, RefreshCw } from "lucide-react";
import { ErrorBanner, Modal } from "./ui";
import { isOkEnvelope, parseError, type MemberRow } from "./types";

/**
 * 重寄驗證信：POST /api/admin/members/[id]/resend-verification（body {}）
 *   → { ok:true, data:{ sent:true } }
 *   → { ok:true, data:{ sent:false, action_link, note } }
 *   失敗 → 400 { ok:false, error }
 *
 * 為什麼開對話框就自動寄：管理員點信封圖示的意圖就只有「寄驗證信」，
 * 再要他按一次確認只是多一步。sent:false 代表站內郵件未設定，
 * 後端改回傳可自行轉發的 action_link，此時把 note 與連結一起顯示。
 */

type Phase = "sending" | "sent" | "manual" | "error";

export function MemberVerificationDialog({
  member,
  onClose,
}: {
  member: MemberRow;
  onClose: () => void;
}) {
  const displayName = member.display_name?.trim() || member.email || "（未具名會員）";
  const email = member.email ?? "無電郵";

  const [phase, setPhase] = useState<Phase>("sending");
  const [note, setNote] = useState<string | null>(null);
  const [actionLink, setActionLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const startedRef = useRef(false);
  const copyTimer = useRef<number | null>(null);

  async function send() {
    setPhase("sending");
    setError(null);
    setNote(null);
    setActionLink(null);
    setCopied(false);

    try {
      const res = await fetch(
        `/api/admin/members/${encodeURIComponent(member.member_id)}/resend-verification`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      const body: unknown = await res.json();

      if (!res.ok || !isOkEnvelope<{ sent?: boolean; action_link?: string; note?: string }>(body)) {
        setError(parseError(body, "寄送驗證信失敗。").error);
        setPhase("error");
        return;
      }

      const data = body.data;
      if (data.sent === true) {
        setPhase("sent");
        return;
      }

      setNote(
        typeof data.note === "string" && data.note.trim()
          ? data.note.trim()
          : "站內郵件未設定，請自行把下方連結發給會員。"
      );
      setActionLink(typeof data.action_link === "string" && data.action_link ? data.action_link : null);
      setPhase("manual");
    } catch {
      setError("網路錯誤，請稍後再試。");
      setPhase("error");
    }
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);

  async function copyLink() {
    if (!actionLink) return;
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(actionLink);
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("無法自動複製，請手動選取連結後複製。");
    }
  }

  return (
    <Modal
      title="重寄驗證信"
      description={`${displayName} · ${email}`}
      onClose={() => {
        if (phase !== "sending") onClose();
      }}
      footer={
        <>
          <button
            type="button"
            onClick={() => void send()}
            disabled={phase === "sending"}
            className="btn-base btn-ghost"
          >
            {phase === "sending" ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            重新寄送
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === "sending"}
            className="btn-base btn-cobalt"
          >
            關閉
          </button>
        </>
      }
    >
      <div className="space-y-3" aria-live="polite">
        {phase === "sending" && (
          <div className="flex items-center gap-2.5 rounded-xl border border-ink-line bg-white/5 px-4 py-3 text-sm text-white/70">
            <Loader2 size={17} className="shrink-0 animate-spin" />
            <span>正在寄送驗證信…</span>
          </div>
        )}

        {phase === "sent" && (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
          >
            <Mail size={17} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">
              驗證信已寄出，請提醒會員到信箱（含垃圾郵件）點擊驗證連結。
            </span>
          </div>
        )}

        {phase === "manual" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <p className="break-words">{note ?? "站內郵件未設定，請自行把下方連結發給會員。"}</p>
            </div>
            {actionLink ? (
              <div className="rounded-xl border border-ink-line bg-white/5 px-4 py-3">
                <p className="text-xs text-white/55">驗證連結</p>
                <p className="mt-1 break-all text-xs text-white/85">{actionLink}</p>
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  aria-label={copied ? "已複製驗證連結" : "複製驗證連結"}
                  className="btn-base btn-ghost mt-2 px-3 py-1.5 text-xs"
                >
                  {copied ? (
                    <>
                      <Check size={14} /> 已複製
                    </>
                  ) : (
                    <>
                      <Copy size={14} /> 複製連結
                    </>
                  )}
                </button>
              </div>
            ) : (
              <p className="text-xs text-white/50">後端未提供驗證連結。</p>
            )}
          </div>
        )}

        {phase === "error" && error && <ErrorBanner message={error} />}
      </div>
    </Modal>
  );
}
