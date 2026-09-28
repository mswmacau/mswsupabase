"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { RULES } from "@/lib/config";

/** F-S1：密碼最短長度（同 /api/auth/signup 嘅檢查一致） */
const PASSWORD_MIN = 6;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldKey = "email" | "password" | "confirm_password";
type FieldErrors = Partial<Record<FieldKey, string>>;

/** 電郵格式、密碼長度、兩次密碼一致（錯誤文案沿用既有 API 訊息） */
function validateFields(values: {
  email: string;
  password: string;
  confirmPassword: string;
}): FieldErrors {
  const found: FieldErrors = {};

  if (!EMAIL_PATTERN.test(values.email.trim())) {
    found.email = "請輸入有效的電郵地址。";
  }
  if (values.password.length < PASSWORD_MIN) {
    found.password = "密碼至少需要 6 個字元。";
  }
  if (values.confirmPassword !== values.password) {
    found.confirm_password = "兩次輸入的密碼不一致，請重新輸入。";
  }

  return found;
}

export function SignupForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /** F-S1：blur 即時驗證嘅欄位錯誤 */
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  /** 直接用 FormData 讀現有欄位，唔改 input 嘅受控／非受控行為 */
  function readFields(form: HTMLFormElement) {
    const fd = new FormData(form);
    return {
      email: String(fd.get("email") ?? ""),
      password: String(fd.get("password") ?? ""),
      confirmPassword: String(fd.get("confirm_password") ?? ""),
    };
  }

  /** blur 時只更新嗰個欄位（避免仲未填 confirm 就彈錯） */
  function handleBlur(e: React.FocusEvent<HTMLFormElement>) {
    const name = (e.target as HTMLElement).getAttribute("name");
    if (
      name !== "email" &&
      name !== "password" &&
      name !== "confirm_password"
    ) {
      return;
    }
    const found = validateFields(readFields(e.currentTarget));
    setFieldErrors((prev) => ({ ...prev, [name]: found[name] }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const fd = new FormData(e.currentTarget);

    // 確認密碼：兩次輸入不一致時擋下，不送出請求
    const password = String(fd.get("password") ?? "");
    const confirmPassword = String(fd.get("confirm_password") ?? "");
    if (password !== confirmPassword) {
      setError("兩次輸入的密碼不一致，請重新輸入。");
      setFieldErrors((prev) => ({
        ...prev,
        confirm_password: "兩次輸入的密碼不一致，請重新輸入。",
      }));
      return;
    }

    // F-S1：送出前先跑一次即時驗證，有錯就唔好送 request
    const found = validateFields({
      email: String(fd.get("email") ?? ""),
      password,
      confirmPassword,
    });
    if (Object.keys(found).length > 0) {
      setFieldErrors(found);
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
    <form onSubmit={onSubmit} onBlur={handleBlur} className="space-y-5">
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
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
          className={`field ${fieldErrors.email ? "border-red-500/70" : ""}`}
        />
        {fieldErrors.email && (
          <p id="email-error" className="mt-1.5 text-xs text-red-300">
            {fieldErrors.email}
          </p>
        )}
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
          minLength={PASSWORD_MIN}
          placeholder="••••••••"
          aria-invalid={fieldErrors.password ? true : undefined}
          aria-describedby={fieldErrors.password ? "password-error" : undefined}
          className={`field ${fieldErrors.password ? "border-red-500/70" : ""}`}
        />
        {fieldErrors.password && (
          <p id="password-error" className="mt-1.5 text-xs text-red-300">
            {fieldErrors.password}
          </p>
        )}
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
          aria-describedby={
            fieldErrors.confirm_password
              ? "confirm-password-hint confirm-password-error"
              : "confirm-password-hint"
          }
          aria-invalid={fieldErrors.confirm_password ? true : undefined}
          className={`field ${
            fieldErrors.confirm_password ? "border-red-500/70" : ""
          }`}
        />
        {fieldErrors.confirm_password && (
          <p
            id="confirm-password-error"
            className="mt-1.5 text-xs text-red-300"
          >
            {fieldErrors.confirm_password}
          </p>
        )}
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
