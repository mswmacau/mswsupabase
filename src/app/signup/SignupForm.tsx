"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { RULES } from "@/lib/config";

export function SignupForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const fd = new FormData(e.currentTarget);

    // 確認密碼：兩次輸入不一致時擋下，不送出請求
    const password = String(fd.get("password") ?? "");
    const confirmPassword = String(fd.get("confirm_password") ?? "");
    if (password !== confirmPassword) {
      setError("兩次輸入的密碼不一致，請重新輸入。");
      return;
    }

    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: fd.get("email"),
          password: fd.get("password"),
          display_name: fd.get("display_name"),
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        message?: string;
        needConfirm?: boolean;
        next?: string;
      };

      if (!data.ok) {
        setError(data.error ?? "註冊失敗。");
        setPending(false);
        return;
      }

      if (data.needConfirm) {
        setDone(
          data.message ?? "註冊成功！請到電郵信箱點擊驗證連結完成啟用，之後即可登入。"
        );
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

  if (done) {
    return (
      <div className="space-y-5">
        <div
          role="status"
          aria-live="polite"
          className="slab flex items-start gap-2.5 border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
        >
          <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
          <span>{done}</span>
        </div>
        <Link
          href="/login"
          className="btn-base btn-cobalt btn-slab min-h-11 w-full"
        >
          前往登入
        </Link>
      </div>
    );
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
        <label className="label" htmlFor="display_name">
          顯示名稱（排行榜上顯示）
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          placeholder="例如：阿健"
          className="field"
        />
      </div>

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
          密碼（至少 6 個字元）
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          placeholder="••••••••"
          className="field"
        />
      </div>

      <div>
        <label className="label" htmlFor="confirm_password">
          確認密碼（請再輸入一次）
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          required
          placeholder="••••••••"
          aria-describedby="confirm-password-hint"
          className="field"
        />
        <p id="confirm-password-hint" className="mt-1.5 text-xs text-white/55">
          請再次輸入相同密碼，兩次不一致時無法提交。
        </p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="btn-base btn-vital btn-slab min-h-11 w-full"
      >
        {pending ? (
          <>
            <Loader2 size={17} className="animate-spin" /> 註冊中…
          </>
        ) : (
          <>
            建立帳號 <ArrowRight size={17} />
          </>
        )}
      </button>

      <div className="border-l-2 border-cobalt/60 bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-white/70">
        <span className="mb-1 flex items-center gap-1.5 font-semibold text-white/85">
          <MailCheck size={14} className="text-accent-blue" /> 關於電郵驗證
        </span>
        送出後註冊即時完成，不需要收取驗證信——直接以上述電郵與密碼
        <Link href="/login" className="font-semibold text-accent-blue hover:underline">
          登入
        </Link>
        即可。
      </div>

      <p className="text-xs leading-relaxed text-white/70">
        註冊即表示同意 MSW 街健館的活動規則：跑步里程須經後台確認後始計入積分，
        偽造紀錄將被取消資格。完成月度 {RULES.MONTHLY_GOAL_KM}km 可獲優惠券。
      </p>

      <p className="border-t border-[var(--line-fine)] pt-5 text-center text-sm text-white/70">
        已有帳號？{" "}
        <Link
          href="/login"
          className="font-semibold text-accent-blue hover:underline"
        >
          會員登入
        </Link>
      </p>
    </form>
  );
}
