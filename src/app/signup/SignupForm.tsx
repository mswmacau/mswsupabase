"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { DEFAULT_PAGES, type SitePageSignup } from "@/lib/content";

/** F-S1：密碼最短長度（同 /api/auth/signup 嘅檢查一致） */
const PASSWORD_MIN = 6;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldKey = "email" | "password" | "confirm_password";
type FieldErrors = Partial<Record<FieldKey, string>>;

/** 電郵格式、密碼長度、兩次密碼一致（錯誤文案讀 site_pages，回落預設） */
function validateFields(
  values: {
    email: string;
    password: string;
    confirmPassword: string;
  },
  labels: SitePageSignup
): FieldErrors {
  const found: FieldErrors = {};

  if (!EMAIL_PATTERN.test(values.email.trim())) {
    found.email = labels.error_email;
  }
  if (values.password.length < PASSWORD_MIN) {
    found.password = labels.error_password;
  }
  if (values.confirmPassword !== values.password) {
    found.confirm_password = labels.error_confirm;
  }

  return found;
}

/**
 * verify_note 內嵌「登入」連結：以首次出現嘅「登入」二字切分，
 * 前半純文字 + 命中段包 Link + 後半純文字，兼顧 DB 可編輯與零 DOM 差異。
 * DB 值不含「登入」時整串當純文字渲染（不會產生空連結）。
 */
function renderVerifyNote(note: string) {
  const idx = note.indexOf("登入");
  if (idx < 0) return note;
  return (
    <>
      {note.slice(0, idx)}
      <Link href="/login" className="font-semibold text-accent-blue hover:underline">
        登入
      </Link>
      {note.slice(idx + 2)}
    </>
  );
}

export function SignupForm({
  labels = DEFAULT_PAGES.signup,
}: {
  labels?: SitePageSignup;
}) {
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
    const found = validateFields(readFields(e.currentTarget), labels);
    setFieldErrors((prev) => ({ ...prev, [name]: found[name] }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const fd = new FormData(e.currentTarget);

    // 確認密碼：兩次輸入不一致時擋下，不送出請求
    const password = String(fd.get("password") ?? "");
    const confirmPassword = String(fd.get("confirm_password") ?? "");
    if (password !== confirmPassword) {
      setError(labels.error_confirm);
      setFieldErrors((prev) => ({
        ...prev,
        confirm_password: labels.error_confirm,
      }));
      return;
    }

    // F-S1：送出前先跑一次即時驗證，有錯就唔好送 request
    const found = validateFields(
      {
        email: String(fd.get("email") ?? ""),
        password,
        confirmPassword,
      },
      labels
    );
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
        setError(data.error ?? labels.error_submit);
        setPending(false);
        return;
      }

      if (data.needConfirm) {
        setDone(data.message ?? labels.success_message);
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
          {labels.display_name_label}
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          placeholder={labels.display_name_placeholder}
          className="field"
        />
      </div>

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
          {labels.password_label}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          placeholder={labels.password_placeholder}
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
          {labels.confirm_label}
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          required
          placeholder={labels.confirm_placeholder}
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
          {labels.confirm_hint}
        </p>
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

      <div className="border-l-2 border-cobalt/60 bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-white/70">
        <span className="mb-1 flex items-center gap-1.5 font-semibold text-white/85">
          <MailCheck size={14} className="text-accent-blue" /> 關於電郵驗證
        </span>
        {renderVerifyNote(labels.verify_note)}
      </div>

      <p className="text-xs leading-relaxed text-white/70">{labels.rules_note}</p>

      <p className="border-t border-[var(--line-fine)] pt-5 text-center text-sm text-white/70">
        {labels.login_prompt}{" "}
        <Link
          href="/login"
          className="font-semibold text-accent-blue hover:underline"
        >
          {labels.login_link}
        </Link>
      </p>
    </form>
  );
}
