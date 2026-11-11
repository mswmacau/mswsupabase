"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { DEFAULT_PAGES, type SitePageLogin } from "@/lib/content";
import { safeNext } from "@/lib/safe-next";
import { GoogleAuthButton } from "@/components/GoogleAuthButton";

export function LoginForm({
  next,
  labels = DEFAULT_PAGES.login,
  oauthError = null,
}: {
  next: string;
  labels?: SitePageLogin;
  /** /login?error=oauth 帶進來的訊息：直接顯示在既有紅框內 */
  oauthError?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(oauthError);
  /** 只有非預設 next 才附上 query，避免無謂參數 */
  const signupHref =
    next === "/dashboard" ? "/signup" : `/signup?next=${encodeURIComponent(next)}`;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const fd = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: fd.get("email"),
          password: fd.get("password"),
          next,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        next?: string;
      };

      if (!data.ok) {
        setError(data.error ?? labels.error_message);
        setPending(false);
        return;
      }

      router.push(safeNext(data.next, "/dashboard"));
      router.refresh();
    } catch {
      setError("網路錯誤，請稍後再試。");
      setPending(false);
    }
  }

  return (
    <>
      {/* 表單卡頂部：用途標籤（讓用戶一眼分辨這一頁是登入不是註冊） */}
      <div className="mb-5">
        <h2 className="flex flex-wrap items-center gap-x-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
          <span>會員登入</span>
          <span aria-hidden="true" className="text-white/30">
            /
          </span>
          <span>MEMBER LOGIN</span>
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          已有帳號。用 Email 或 Google 登入，繼續累積你的紀錄。
        </p>
      </div>

      {/* OAuth 走整頁導向，刻意放在 <form> 之外，不混進 submit 流程 */}
      <GoogleAuthButton next={next} />

      <form onSubmit={onSubmit} className="space-y-5">
        {error && (
          <div
            role="alert"
            aria-live="polite"
            className="slab flex items-start gap-2.5 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          >
            <AlertCircle size={17} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="label" htmlFor="email">
            {labels.email_label}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder={labels.email_placeholder}
            className="field"
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            {labels.password_label}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder={labels.password_placeholder}
            className="field"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="btn-base btn-vital btn-slab min-h-11 w-full"
        >
          {pending ? (
            <>
              <Loader2 size={17} className="animate-spin" /> {labels.pending_label}
            </>
          ) : (
            <>
              {labels.submit_label} <ArrowRight size={17} />
            </>
          )}
        </button>

        <p className="flex min-h-11 flex-wrap items-center justify-center gap-x-1.5 border-t border-[var(--line-fine)] pt-5 text-center text-sm text-white/70">
          {labels.signup_prompt}{" "}
          <Link
            href={signupHref}
            className="inline-flex min-h-11 items-center gap-1 font-semibold text-accent-blue hover:underline"
          >
            {labels.signup_link}
            <span aria-hidden="true">→</span>
          </Link>
        </p>
      </form>
    </>
  );
}
