"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { safeNext } from "@/lib/safe-next";

const MSG = {
  full_name: "請填寫真實姓名（2–40 字）。",
  gender: "請選擇性別。",
  phone: "請填寫 8 位數字電話號碼。",
  id_last4: "請填寫身份證後四位（4 位數字）。",
  submit: "提交失敗，請稍後再試。",
  network: "網路錯誤，請稍後再試。",
} as const;

type FieldKey = "full_name" | "gender" | "phone" | "id_last4";
type FieldErrors = Partial<Record<FieldKey, string>>;

const GENDERS = [
  { value: "male", label: "男" },
  { value: "female", label: "女" },
  { value: "undisclosed", label: "不方便透露" },
] as const;

/** 電話正規化：去掉空白／括號／連字號，只留一個 +853 前綴 */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s\-().]/g, "");
  return digits.replace(/^\+?853(?=\d{8}$)/, "+853");
}

const PHONE_PATTERN = /^(\+853)?\d{8}$/;

/** 與註冊頁同一套規則，blur 即時驗證 */
function validateValues(values: {
  fullName: string;
  gender: string;
  phone: string;
  idLast4: string;
}): FieldErrors {
  const found: FieldErrors = {};

  const name = values.fullName.trim();
  if (name.length < 2 || name.length > 40) found.full_name = MSG.full_name;

  if (!GENDERS.some((g) => g.value === values.gender)) found.gender = MSG.gender;

  if (!PHONE_PATTERN.test(normalizePhone(values.phone))) found.phone = MSG.phone;

  if (!/^\d{4}$/.test(values.idLast4.trim())) found.id_last4 = MSG.id_last4;

  return found;
}

export type ProfileDefaults = {
  full_name: string;
  gender: string;
  phone: string;
  id_last4: string;
};

export function CompleteProfileForm({
  next,
  email,
  defaults,
}: {
  next: string;
  email: string;
  defaults: ProfileDefaults;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function readFields(form: HTMLFormElement) {
    const fd = new FormData(form);
    return {
      fullName: String(fd.get("full_name") ?? ""),
      gender: String(fd.get("gender") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      idLast4: String(fd.get("id_last4") ?? ""),
    };
  }

  /** blur 只更新該欄位，避免一進頁面就滿屏紅字 */
  function handleBlur(e: React.FocusEvent<HTMLFormElement>) {
    const name = (e.target as HTMLElement).getAttribute("name");
    if (
      name !== "full_name" &&
      name !== "gender" &&
      name !== "phone" &&
      name !== "id_last4"
    ) {
      return;
    }
    const found = validateValues(readFields(e.currentTarget));
    setFieldErrors((prev) => ({ ...prev, [name]: found[name] }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const values = readFields(e.currentTarget);
    const found = validateValues(values);
    if (Object.keys(found).length > 0) {
      setFieldErrors(found);
      setError(null);
      return;
    }

    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/profile/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: values.fullName.trim(),
          gender: values.gender,
          phone: normalizePhone(values.phone),
          id_last4: values.idLast4.trim(),
        }),
      });

      // 端點異常時可能是 404／HTML，parse 失敗要走可讀錯誤，不可靜默成功
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        fields?: Record<string, string>;
      } | null;

      if (!res.ok || !data?.ok) {
        // API 會回 { ok:false, error, code, fields? }：欄位級錯誤優先貼回各自欄位
        if (data?.fields) {
          setFieldErrors((prev) => ({
            ...prev,
            ...(data.fields as FieldErrors),
          }));
        }
        setError(
          data?.error ??
            (res.status === 401
              ? "登入狀態已過期，請重新登入。"
              : MSG.submit)
        );
        setPending(false);
        return;
      }

      router.push(safeNext(next, "/dashboard"));
      router.refresh();
    } catch {
      setError(MSG.network);
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} onBlur={handleBlur} className="space-y-5" noValidate>
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

      {/* 電郵來自 session，不可改：用唯讀輸入呈現，避免看起來像可編輯 */}
      <div>
        <label className="label" htmlFor="email">
          電子郵箱
        </label>
        <input
          id="email"
          name="email"
          type="email"
          value={email}
          readOnly
          aria-readonly="true"
          aria-describedby="email-locked-hint"
          className="field cursor-not-allowed opacity-70"
        />
        <p id="email-locked-hint" className="mt-1.5 text-xs text-white/55">
          電郵由登入帳號決定，無法在此修改。
        </p>
      </div>

      <div>
        <label className="label" htmlFor="full_name">
          姓名（真實姓名）
        </label>
        <input
          id="full_name"
          name="full_name"
          type="text"
          autoComplete="name"
          required
          defaultValue={defaults.full_name}
          placeholder="陳大文"
          aria-invalid={fieldErrors.full_name ? true : undefined}
          aria-describedby={fieldErrors.full_name ? "full-name-error" : undefined}
          className={`field ${fieldErrors.full_name ? "border-red-500/70" : ""}`}
        />
        {fieldErrors.full_name && (
          <p id="full-name-error" className="mt-1.5 text-xs text-red-300">
            {fieldErrors.full_name}
          </p>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="min-w-0">
          <label className="label" htmlFor="gender">
            性別
          </label>
          <select
            id="gender"
            name="gender"
            required
            defaultValue={defaults.gender}
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

        <div className="min-w-0">
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
            defaultValue={defaults.phone}
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
      </div>

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
          maxLength={4}
          required
          defaultValue={defaults.id_last4}
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
            <Loader2 size={17} className="animate-spin" /> 提交中…
          </>
        ) : (
          <>
            完成註冊 <ArrowRight size={17} />
          </>
        )}
      </button>
    </form>
  );
}
