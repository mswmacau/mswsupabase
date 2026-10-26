"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * 會員端：重設密碼 /auth/reset
 *
 * Supabase 的重設信會把 recovery 會話放在 URL fragment：
 *   /auth/reset#access_token=...&refresh_token=...&type=recovery
 * 若專案改用 PKCE flow，則改帶 query 的 ?code=...
 * 兩種都要吃，所以這裡同時讀 hash 與 search：
 *   1. 有 access_token + refresh_token → supabase.auth.setSession
 *   2. 有 code → supabase.auth.exchangeCodeForSession
 *   3. 都沒有 → 再問一次 getSession（使用者可能已在此頁完成交換後重新整理）
 *
 * 這個頁面刻意不做「必須已登入」的檢查：
 *  - 重設連結在會員自己的裝置打開，當下不一定有登入態
 *  - proxy 的 matcher 只有 /dashboard 與 /admin，不會攔到 /auth/*
 *
 * 驗證完把 fragment 清掉（history.replaceState），避免 token 留在網址列、
 * 被複製到截圖或瀏覽紀錄。
 */

type Phase = "checking" | "unconfigured" | "ready" | "success" | "error";

const CLEAN_PATH = "/auth/reset";

function readHash(): URLSearchParams {
  const raw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(raw);
}

export default function ResetPasswordPage() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});

  const startedRef = useRef(false);
  /** 整個頁面共用同一個 Supabase 實例：setSession 後立刻 updateUser 才會看到同一份會話 */
  const clientRef = useRef<SupabaseClient | null>(null);

  function getClient(): SupabaseClient | null {
    if (!isSupabaseConfigured) return null;
    if (!clientRef.current) clientRef.current = createClient();
    return clientRef.current;
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrap() {
    const supabase = getClient();
    if (!supabase) {
      setPhase("unconfigured");
      return;
    }

    try {
      const hash = readHash();
      const query = new URLSearchParams(window.location.search);

      const oauthError = hash.get("error") ?? query.get("error");
      const oauthErrorDesc = hash.get("error_description") ?? query.get("error_description");
      if (oauthError) {
        setError(
          oauthErrorDesc?.trim() ||
            "這個重設連結已失效或已被使用，請重新申請一次重設密碼。"
        );
        setPhase("error");
        return;
      }

      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const code = query.get("code");

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) {
          setError("這個重設連結已失效或已被使用，請重新申請一次重設密碼。");
          setPhase("error");
          return;
        }
        window.history.replaceState(null, "", CLEAN_PATH);
        setPhase("ready");
        return;
      }

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError("這個重設連結已失效或已被使用，請重新申請一次重設密碼。");
          setPhase("error");
          return;
        }
        window.history.replaceState(null, "", CLEAN_PATH);
        setPhase("ready");
        return;
      }

      // 沒有 fragment／code：可能已經交換過會話（例如重新整理本頁）
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        window.history.replaceState(null, "", CLEAN_PATH);
        setPhase("ready");
        return;
      }

      setError("此重設連結缺少必要參數，可能已過期或已被使用。");
      setPhase("error");
    } catch {
      setError("無法驗證重設連結，請稍後再試。");
      setPhase("error");
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: { password?: string; confirm?: string } = {};

    if (password.length < 8) next.password = "密碼至少 8 個字元。";
    if (!confirm) next.confirm = "請再輸入一次新密碼。";
    else if (confirm !== password) next.confirm = "兩次輸入的密碼不一致。";

    if (Object.keys(next).length > 0) {
      setFieldErrors(next);
      setFormError("請先修正以下欄位。");
      return;
    }

    const supabase = getClient();
    if (!supabase) {
      setFormError("尚未設定 Supabase 環境變數，暫時無法更新密碼。");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setFormError(
          updateError.message?.trim() ||
            "更新密碼失敗，連結可能已過期，請重新申請一次重設密碼。"
        );
        return;
      }
      setPassword("");
      setConfirm("");
      setPhase("success");
    } catch {
      setFormError("網路錯誤，請稍後再試。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="relative min-h-screen-safe overflow-hidden pb-20 pt-24 md:pt-28">
      <div className="grid-lines pointer-events-none absolute inset-0" />
      <div className="noise-overlay pointer-events-none absolute inset-0" />

      <div className="container-msw relative z-10">
        <div className="card-dark mx-auto w-full max-w-md p-6 sm:p-8">
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-white/70 transition hover:text-white"
          >
            <ArrowLeft size={15} /> 回到登入
          </Link>

          <h1 className="mt-4 text-2xl font-bold">設定新密碼</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/65">
            請輸入新的登入密碼，設定完成後即可用新密碼登入 MSW 街健館。
          </p>

          <div className="mt-6">
            {phase === "checking" && (
              <div
                className="flex items-center gap-2.5 rounded-xl border border-ink-line bg-white/5 px-4 py-3 text-sm text-white/70"
                aria-live="polite"
              >
                <Loader2 size={17} className="shrink-0 animate-spin" />
                <span>正在驗證重設連結…</span>
              </div>
            )}

            {phase === "unconfigured" && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
              >
                <KeyRound size={17} className="mt-0.5 shrink-0" />
                <span className="min-w-0 flex-1 break-words">
                  尚未設定 Supabase 環境變數（NEXT_PUBLIC_SUPABASE_URL／
                  NEXT_PUBLIC_SUPABASE_ANON_KEY），此頁暫時無法使用。
                </span>
              </div>
            )}

            {phase === "error" && (
              <div className="space-y-4">
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                >
                  <AlertCircle size={17} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1 break-words">
                    {error ?? "重設連結無效或已過期。"}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-white/55">
                  重設連結有時效，且只能使用一次。請回到登入頁重新申請「忘記密碼」，
                  或透過 WhatsApp 聯絡館方人員協助重寄。
                </p>
                <Link href="/login" className="btn-base btn-vital w-full">
                  回登入頁重新申請
                </Link>
              </div>
            )}

            {phase === "ready" && (
              <form onSubmit={submit} className="space-y-4" noValidate>
                {formError && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
                  >
                    <AlertCircle size={17} className="mt-0.5 shrink-0" />
                    <span className="min-w-0 flex-1 break-words">{formError}</span>
                  </div>
                )}

                <div>
                  <label className="label" htmlFor="reset-password">
                    新密碼
                  </label>
                  <input
                    id="reset-password"
                    type="password"
                    className="field"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="至少 8 個字元"
                    autoComplete="new-password"
                    data-autofocus
                  />
                  {fieldErrors.password ? (
                    <p className="mt-1 text-xs text-red-300">{fieldErrors.password}</p>
                  ) : (
                    <p className="mt-1 text-xs text-white/50">至少 8 個字元。</p>
                  )}
                </div>

                <div>
                  <label className="label" htmlFor="reset-confirm">
                    確認新密碼
                  </label>
                  <input
                    id="reset-confirm"
                    type="password"
                    className="field"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    placeholder="再輸入一次新密碼"
                    autoComplete="new-password"
                  />
                  {fieldErrors.confirm && (
                    <p className="mt-1 text-xs text-red-300">{fieldErrors.confirm}</p>
                  )}
                </div>

                <button type="submit" disabled={submitting} className="btn-base btn-vital w-full">
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> 更新中…
                    </>
                  ) : (
                    <>
                      <KeyRound size={16} /> 更新密碼
                    </>
                  )}
                </button>
              </form>
            )}

            {phase === "success" && (
              <div className="space-y-4">
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-start gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
                >
                  <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1 break-words">
                    密碼已更新，請用新密碼重新登入。
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-white/55">
                  若這個帳號還開著其他裝置，那些裝置可能需要重新登入。
                </p>
                <Link href="/login" className="btn-base btn-vital w-full">
                  前往登入
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
