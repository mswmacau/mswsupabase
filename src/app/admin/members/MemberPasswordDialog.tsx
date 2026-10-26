"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, KeyRound, Link2, Loader2 } from "lucide-react";
import { ErrorBanner, Modal } from "./ui";
import { isOkEnvelope, parseError, type MemberRow } from "./types";

/**
 * 重設密碼：POST /api/admin/members/[id]/reset-password
 *   body { mode:'temp' } → { ok:true, data:{ mode:'temp', email, password } }
 *   body { mode:'link' } → { ok:true, data:{ mode:'link', email, action_link } }
 *   無金鑰 → 501 { ok:false, code:'SERVICE_ROLE_REQUIRED', error }
 *
 * 兩種模式差異（畫面上要講清楚，否則管理員會誤發連結）：
 *  - 臨時密碼：立即覆蓋舊密碼，必須自行把新密碼交給會員
 *  - 重設連結：一次性連結，會員自行設定新密碼，連結不外流就沒風險
 *
 * 501 代表專案沒有 SUPABASE_SERVICE_ROLE_KEY：
 * 此時把兩個產生按鈕一起禁用，並提示要在 Vercel 補環境變數，
 * 避免管理員反覆點擊拿到同一個錯誤。
 */

type Tab = "temp" | "link";

type TempResult = { email: string | null; password: string };
type LinkResult = { email: string | null; actionLink: string };

export function MemberPasswordDialog({
  member,
  onClose,
}: {
  member: MemberRow;
  onClose: () => void;
}) {
  const displayName = member.display_name?.trim() || member.email || "（未具名會員）";

  const [tab, setTab] = useState<Tab>("temp");
  const [busy, setBusy] = useState<Tab | null>(null);
  const [tempResult, setTempResult] = useState<TempResult | null>(null);
  const [linkResult, setLinkResult] = useState<LinkResult | null>(null);
  const [serviceRoleMissing, setServiceRoleMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);

  async function copyText(text: string, key: string) {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setCopied(key);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("無法自動複製，請手動選取文字後複製。");
    }
  }

  async function run(mode: Tab) {
    setBusy(mode);
    setError(null);
    setCopied(null);

    try {
      const res = await fetch(
        `/api/admin/members/${encodeURIComponent(member.member_id)}/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        }
      );
      const body: unknown = await res.json();

      if (res.status === 501) {
        const parsed = parseError(body, "此功能需要服務金鑰。");
        if (parsed.code === "SERVICE_ROLE_REQUIRED") {
          setServiceRoleMissing(true);
          setError("未設定 SUPABASE_SERVICE_ROLE_KEY，請先在 Vercel 加入。");
          return;
        }
      }

      if (mode === "temp") {
        if (!res.ok || !isOkEnvelope<{ email?: string | null; password?: string }>(body)) {
          setError(parseError(body, "產生臨時密碼失敗。").error);
          return;
        }
        const password = body.data.password;
        if (typeof password !== "string" || !password) {
          setError("後端沒有回傳臨時密碼，請稍後再試。");
          return;
        }
        setTempResult({ email: body.data.email ?? member.email ?? null, password });
        return;
      }

      if (!res.ok || !isOkEnvelope<{ email?: string | null; action_link?: string }>(body)) {
        setError(parseError(body, "產生重設連結失敗。").error);
        return;
      }
      const actionLink = body.data.action_link;
      if (typeof actionLink !== "string" || !actionLink) {
        setError("後端沒有回傳重設連結，請稍後再試。");
        return;
      }
      setLinkResult({ email: body.data.email ?? member.email ?? null, actionLink });
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null || serviceRoleMissing;

  return (
    <Modal
      title="重設密碼"
      description={`${displayName} · ${member.email ?? "無電郵"}`}
      onClose={() => {
        if (busy === null) onClose();
      }}
      width="max-w-xl"
      footer={
        <button type="button" onClick={onClose} disabled={busy !== null} className="btn-base btn-ghost">
          關閉
        </button>
      }
    >
      <div className="space-y-4">
        {serviceRoleMissing && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
          >
            <KeyRound size={17} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">
              未設定 SUPABASE_SERVICE_ROLE_KEY，請先在 Vercel 加入。
            </span>
          </div>
        )}

        {error && !serviceRoleMissing && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {/* ===== 頁籤 ===== */}
        <div role="tablist" aria-label="重設密碼方式" className="flex gap-1 rounded-xl border border-ink-line bg-white/5 p-1">
          <button
            type="button"
            role="tab"
            id="pwd-tab-temp"
            aria-selected={tab === "temp"}
            aria-controls="pwd-panel-temp"
            onClick={() => setTab("temp")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
              tab === "temp" ? "bg-cobalt text-white" : "text-white/65 hover:text-white"
            }`}
          >
            臨時密碼
          </button>
          <button
            type="button"
            role="tab"
            id="pwd-tab-link"
            aria-selected={tab === "link"}
            aria-controls="pwd-panel-link"
            onClick={() => setTab("link")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
              tab === "link" ? "bg-cobalt text-white" : "text-white/65 hover:text-white"
            }`}
          >
            重設連結
          </button>
        </div>

        {/* ===== 臨時密碼 ===== */}
        {tab === "temp" && (
          <div
            role="tabpanel"
            id="pwd-panel-temp"
            aria-labelledby="pwd-tab-temp"
            className="space-y-3"
          >
            <p className="text-xs leading-relaxed text-white/60">
              會立即覆蓋舊密碼，請把新密碼交給會員並提醒登入後修改。
            </p>

            <button
              type="button"
              onClick={() => void run("temp")}
              disabled={disabled}
              className="btn-base btn-cobalt w-full"
            >
              {busy === "temp" ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> 產生中…
                </>
              ) : (
                <>
                  <KeyRound size={16} /> 產生臨時密碼
                </>
              )}
            </button>

            {tempResult ? (
              <ResultBox
                label={`臨時密碼${tempResult.email ? `（${tempResult.email}）` : ""}`}
                value={tempResult.password}
                mono
                copied={copied === "temp"}
                onCopy={() => void copyText(tempResult.password, "temp")}
                hint="此密碼只會顯示一次，關閉對話框後無法再次查看。"
              />
            ) : (
              <p className="rounded-xl border border-dashed border-white/15 px-4 py-5 text-center text-xs text-white/45">
                尚未產生臨時密碼。
              </p>
            )}
          </div>
        )}

        {/* ===== 重設連結 ===== */}
        {tab === "link" && (
          <div
            role="tabpanel"
            id="pwd-panel-link"
            aria-labelledby="pwd-tab-link"
            className="space-y-3"
          >
            <p className="text-xs leading-relaxed text-white/60">
              產生一次性連結，自行透過 WhatsApp／電郵發給會員，會員點擊後可設定新密碼。
            </p>

            <button
              type="button"
              onClick={() => void run("link")}
              disabled={disabled}
              className="btn-base btn-cobalt w-full"
            >
              {busy === "link" ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> 產生中…
                </>
              ) : (
                <>
                  <Link2 size={16} /> 產生重設連結
                </>
              )}
            </button>

            {linkResult ? (
              <ResultBox
                label={`重設連結${linkResult.email ? `（${linkResult.email}）` : ""}`}
                value={linkResult.actionLink}
                copied={copied === "link"}
                onCopy={() => void copyText(linkResult.actionLink, "link")}
                hint="連結只能使用一次，轉發前請確認收件人正確。"
              />
            ) : (
              <p className="rounded-xl border border-dashed border-white/15 px-4 py-5 text-center text-xs text-white/45">
                尚未產生重設連結。
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ResultBox({
  label,
  value,
  copied,
  onCopy,
  hint,
  mono = false,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  hint: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-emerald-200/80">{label}</p>
          <p
            className={`mt-1 break-all text-sm text-emerald-100 ${mono ? "font-mono" : ""}`}
          >
            {value}
          </p>
        </div>
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? "已複製" : "複製"}
          className="btn-base btn-ghost shrink-0 px-3 py-1.5 text-xs"
        >
          {copied ? (
            <>
              <Check size={14} /> 已複製
            </>
          ) : (
            <>
              <Copy size={14} /> 複製
            </>
          )}
        </button>
      </div>
      <p className="mt-2 text-xs text-emerald-200/70">{hint}</p>
    </div>
  );
}
