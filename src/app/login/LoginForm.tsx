"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";

export function LoginForm({ next }: { next: string }) {
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
        setError(data.error ?? "登入失敗。");
        setPending(false);
        return;
      }

      router.push(data.next ?? "/dashboard");
      router.refresh();
    } catch {
      setError("網路錯誤，請稍後再試。");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div>
        <label className="label" htmlFor="email">
          電郵
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className="field"
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          密碼
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          className="field"
        />
      </div>

      <button type="submit" disabled={pending} className="btn-base btn-vital w-full">
        {pending ? (
          <>
            <Loader2 size={17} className="animate-spin" /> 登入中…
          </>
        ) : (
          <>
            登入 <ArrowRight size={17} />
          </>
        )}
      </button>

      <p className="text-center text-sm text-white/50">
        還沒有帳號？{" "}
        <Link href="/signup" className="font-semibold text-blue-300 hover:underline">
          立即註冊
        </Link>
      </p>
    </form>
  );
}
