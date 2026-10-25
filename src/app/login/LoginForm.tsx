"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { DEFAULT_PAGES, type SitePageLogin } from "@/lib/content";
import { safeNext } from "@/lib/safe-next";

export function LoginForm({
  next,
  labels = DEFAULT_PAGES.login,
}: {
  next: string;
  labels?: SitePageLogin;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      <p className="border-t border-[var(--line-fine)] pt-5 text-center text-sm text-white/70">
        {labels.signup_prompt}{" "}
        <Link
          href="/signup"
          className="font-semibold text-accent-blue hover:underline"
        >
          {labels.signup_link}
        </Link>
      </p>
    </form>
  );
}
