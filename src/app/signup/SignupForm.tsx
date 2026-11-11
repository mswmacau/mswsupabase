"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { DEFAULT_PAGES, type SitePageSignup } from "@/lib/content";

/** F-S1：密碼最短長度（前端較 API 嚴格，見交付說明） */
const PASSWORD_MIN = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^(\+853)?\d{8}$/;
const ID_LAST4_PATTERN = /^\d{4}$/;

/** 新增欄位的文案（SitePageSignup 沒有對應鍵，且 content.ts 不在本次改動範圍） */
const MSG = {
  full_name: "請填寫真實姓名（2–40 字）。",
  display_name: "請填寫顯示名稱（2–20 字）。",
  gender: "請選擇性別。",
  phone: "請填寫 8 位數字電話號碼。",
  id_last4: "請填寫身份證後四位（4 位數字）。",
} as const;

/** blur 即時驗證要處理的欄位（單一來源，避免漏欄位） */
const FIELD_NAMES: FieldKey[] = [
  "email",
  "password",
  "confirm_password",
  "full_name",
  "display_name",
  "gender",
  "phone",
  "id_last4",
];

const GENDERS = [
  { value: "male", label: "男" },
  { value: "female", label: "女" },
  { value: "undisclosed", label: "不方便透露" },
] as const;

type FieldKey =
  | "email"
  | "password"
  | "confirm_password"
  | "full_name"
  | "display_name"
  | "gender"
  | "phone"
  | "id_last4";
type FieldErrors = Partial<Record<FieldKey, string>>;

/** 電話正規化：去掉空白／括號／連字號，只留一個 +853 前綴 */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s\-().]/g, "");
  return digits.replace(/^\+?853(?=\d{8}$)/, "+853");
}

/** 電郵格式、密碼長度、兩次密碼一致、姓名長度、暱稱長度、性別、電話、身份證後四位 */
function validateFields(
  values: {
    email: string;
    password: string;
    confirmPassword: string;
    fullName: string;
    displayName: string;
    gender: string;
    phone: string;
    idLast4: string;
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

  const fullName = values.fullName.trim();
  if (fullName.length < 2 || fullName.length > 40) {
    found.full_name = MSG.full_name;
  }

  const displayName = values.displayName.trim();
  if (displayName.length < 2 || displayName.length > 20) {
    found.display_name = MSG.display_name;
  }

  if (!GENDERS.some((g) => g.value === values.gender)) {
    found.gender = MSG.gender;
  }

  if (!PHONE_PATTERN.test(normalizePhone(values.phone))) {
    found.phone = MSG.phone;
  }

  if (!ID_LAST4_PATTERN.test(values.idLast4.trim())) {
    found.id_last4 = MSG.id_last4;
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
      fullName: String(fd.get("full_name") ?? ""),
      displayName: String(fd.get("display_name") ?? ""),
      gender: String(fd.get("gender") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      idLast4: String(fd.get("id_last4") ?? ""),
    };
  }

  /** blur 時只更新嗰個欄位（避免仲未填 confirm 就彈錯） */
  function handleBlur(e: React.FocusEvent<HTMLFormElement>) {
    const name = (e.target as HTMLElement).getAttribute("name");
    if (!name || !FIELD_NAMES.includes(name as FieldKey)) return;

    const found = validateFields(readFields(e.currentTarget), labels);
    setFieldErrors((prev) => ({ ...prev, [name]: found[name as FieldKey] }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const fd = new FormData(e.currentTarget);
    const values = readFields(e.currentTarget);

    // 確認密碼：兩次輸入不一致時擋下，不送出請求
    if (values.password !== values.confirmPassword) {
      setError(labels.error_confirm);
      setFieldErrors((prev) => ({
        ...prev,
        confirm_password: labels.error_confirm,
      }));
      return;
    }

    // F-S1：送出前先跑一次即時驗證，有錯就唔好送 request
    const found = validateFields(values, labels);
    if (Object.keys(found).length > 0) {
      setFieldErrors(found);
      setError(null);
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
          display_name: values.displayName.trim(),
          full_name: values.fullName.trim(),
          gender: values.gender,
          phone: normalizePhone(values.phone),
          id_last4: values.idLast4.trim(),
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

      {/* 1 電子郵箱 */}
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

      {/* 2 密碼 */}
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

      {/* 3 確認密碼 */}
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

      {/* 4 姓名 / 5 顯示名稱：390 寬單欄，sm 以上並排 */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="min-w-0">
          <label className="label" htmlFor="full_name">
            姓名（真實姓名）
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            required
            minLength={2}
            maxLength={40}
            placeholder="陳大文"
            aria-invalid={fieldErrors.full_name ? true : undefined}
            aria-describedby={
              fieldErrors.full_name ? "full-name-error" : undefined
            }
            className={`field ${fieldErrors.full_name ? "border-red-500/70" : ""}`}
          />
          {fieldErrors.full_name && (
            <p id="full-name-error" className="mt-1.5 text-xs text-red-300">
              {fieldErrors.full_name}
            </p>
          )}
        </div>

        <div className="min-w-0">
          <label className="label" htmlFor="display_name">
            {labels.display_name_label}
          </label>
          <input
            id="display_name"
            name="display_name"
            type="text"
            autoComplete="nickname"
            required
            minLength={2}
            maxLength={20}
            placeholder={labels.display_name_placeholder}
            aria-invalid={fieldErrors.display_name ? true : undefined}
            aria-describedby={
              fieldErrors.display_name ? "display-name-error" : undefined
            }
            className={`field ${
              fieldErrors.display_name ? "border-red-500/70" : ""
            }`}
          />
          {fieldErrors.display_name && (
            <p id="display-name-error" className="mt-1.5 text-xs text-red-300">
              {fieldErrors.display_name}
            </p>
          )}
        </div>
      </div>

      {/* 6 性別 */}
      <div>
        <label className="label" htmlFor="gender">
          性別
        </label>
        <select
          id="gender"
          name="gender"
          required
          defaultValue=""
          aria-invalid={fieldErrors.gender ? true : undefined}
          aria-describedby={fieldErrors.gender ? "gender-error" : undefined}
          className={`field ${fieldErrors.gender ? "border-red-500/70" : ""}`}
        >
          <option value="" disabled>
            請選擇
          </option>
          {GENDERS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
        {fieldErrors.gender && (
          <p id="gender-error" className="mt-1.5 text-xs text-red-300">
            {fieldErrors.gender}
          </p>
        )}
      </div>

      {/* 7 電話號碼 */}
      <div>
        <label className="label" htmlFor="phone">
          電話號碼
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="+853 6666 7777"
          aria-invalid={fieldErrors.phone ? true : undefined}
          aria-describedby={fieldErrors.phone ? "phone-error" : undefined}
          className={`field ${fieldErrors.phone ? "border-red-500/70" : ""}`}
        />
        {fieldErrors.phone && (
          <p id="phone-error" className="mt-1.5 text-xs text-red-300">
            {fieldErrors.phone}
          </p>
        )}
      </div>

      {/* 8 身份證後四位 */}
      <div>
        <label className="label" htmlFor="id_last4">
          身份證後四位
        </label>
        <input
          id="id_last4"
          name="id_last4"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          required
          maxLength={4}
          placeholder="1234"
          aria-invalid={fieldErrors.id_last4 ? true : undefined}
          aria-describedby={
            fieldErrors.id_last4
              ? "id-last4-hint id-last4-error"
              : "id-last4-hint"
          }
          className={`field ${fieldErrors.id_last4 ? "border-red-500/70" : ""}`}
        />
        {fieldErrors.id_last4 && (
          <p id="id-last4-error" className="mt-1.5 text-xs text-red-300">
            {fieldErrors.id_last4}
          </p>
        )}
        <p id="id-last4-hint" className="mt-1.5 text-xs text-white/55">
          用於活動報名及保險登記，只會儲存最後四位。
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
