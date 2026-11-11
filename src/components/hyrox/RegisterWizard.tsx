"use client";

/**
 * src/components/hyrox/RegisterWizard.tsx — 三步報名流程（client）
 *
 * Step 1 確認資料（姓名／性別／電話／身份證後四位 ＋ 報名專屬三題）
 * Step 2 免責聲明（凍結文案全文 ＋ 必勾）
 * Step 3 付款（收款碼／費用／收款電話 ＋ 轉帳證明上傳 → 提交）
 *
 * 設計決定：
 *  - 三步的狀態都放在本元件，切步驟不重設（回到上一步資料還在）
 *  - 姓名等四欄若原本有缺，Step 1 標紅提示並擋下一步；四欄會隨報名一併送出，
 *    由 POST /api/hyrox/register 寫回會員檔（前端不另呼叫 profile API）
 *  - 轉帳證明採「選檔即上傳」，拿到 Storage path 才准提交（與 /run 同模式）
 *  - 錯誤一律顯示可讀中文＋可行動連結（依契約 code 分流），不靜默失敗
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Send,
  Smartphone,
} from "lucide-react";
import type { Gender, PaymentStatus } from "@/lib/types";
// 驗證規則與後端共用同一份（src/lib/profile-fields.ts），避免前端放行、後端退回
import { FULL_NAME_MAX, normalizePhone } from "@/lib/profile-fields";
import { StepIndicator } from "./StepIndicator";
import { DisclaimerText } from "./DisclaimerText";
import { ProofUploader } from "./ProofUploader";
import { postHyrox, type RegisterResponse } from "./api";
import { HYROX_GROUP_OPTIONS, feeLabel } from "./shared";

type Step = 1 | 2 | 3;

export interface RegisterWizardProps {
  event: {
    id: string;
    title: string;
    event_date: string | null;
    start_time: string | null;
    location: string | null;
    fee_cents: number | null;
    payment_phone: string | null;
    payment_note: string | null;
  };
  /** 收款 QR 的完整網址；null = 後台未上傳 */
  qrUrl: string | null;
  profile: {
    full_name: string | null;
    gender: Gender | null;
    phone: string | null;
    id_last4: string | null;
  };
}

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: "男" },
  { value: "female", label: "女" },
  { value: "undisclosed", label: "不透露" },
];

export function RegisterWizard({ event, qrUrl, profile }: RegisterWizardProps) {
  const [step, setStep] = useState<Step>(1);

  // Step 1：會員資料（可改，隨報名一併送出）
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [gender, setGender] = useState<Gender | "">(profile.gender ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [idLast4, setIdLast4] = useState(profile.id_last4 ?? "");

  // Step 1：報名專屬三題（不進會員檔）
  const [groupPref, setGroupPref] = useState("");
  const [weeklyFreq, setWeeklyFreq] = useState("");
  const [longestRun, setLongestRun] = useState("");

  // Step 2
  const [agreed, setAgreed] = useState(false);

  // Step 3
  const [proofPath, setProofPath] = useState<string | null>(null);

  // 提交狀態
  const [pending, setPending] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [done, setDone] = useState<{
    id: string;
    payment_status: PaymentStatus;
  } | null>(null);

  // 超過 3 秒給文字說明，而不是只有轉圈
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [pending]);

  /** 哪幾欄沒填（Step 1 標紅用）；規則對齊後端 src/lib/profile-fields.ts */
  const missing = {
    full_name: fullName.trim() === "",
    gender: gender === "",
    // 8 位澳門手機（可帶 +853）；規則直接用後端的 normalizePhone
    phone: normalizePhone(phone.trim()) === null,
    // 後端只收 4 位數字（/^[0-9]{4}$/），前端先擋，免得送出去才被退回
    id_last4: !/^[0-9]{4}$/.test(idLast4.trim()),
  };
  const missingKeys = Object.entries(missing)
    .filter(([, v]) => v)
    .map(([k]) => k);
  const hasMissing = missingKeys.length > 0;

  function scrollTop() {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function goStep(next: Step) {
    setError(null);
    setStep(next);
    scrollTop();
  }

  function handleNext() {
    if (step === 1) {
      if (hasMissing) {
        setError({
          code: "VALIDATION",
          message:
            "請先補齊標紅的欄位：姓名（2–40 字）、性別、8 位澳門電話、身份證後四位數字。",
        });
        return;
      }
      if (!groupPref || weeklyFreq.trim() === "" || longestRun.trim() === "") {
        // 後端契約：answers 三欄任一空白就是 400 VALIDATION，所以這裡先擋
        setError({
          code: "VALIDATION",
          message:
            groupPref === ""
              ? "請選擇希望參與的組別。"
              : "請填寫「每週運動次數」與「最長跑步距離」，這兩題是分組用的必填項。",
        });
        return;
      }
      goStep(2);
      return;
    }
    if (step === 2) {
      if (!agreed) return; // 按鈕本身已 disabled，這裡只是雙保險
      goStep(3);
    }
  }

  async function submit() {
    if (!proofPath) return;
    setPending(true);
    setSlow(false);
    setError(null);

    const res = await postHyrox<RegisterResponse>("/api/hyrox/register", {
      event_id: event.id,
      profile: {
        full_name: fullName.trim(),
        gender: gender as Gender,
        phone: phone.trim(),
        id_last4: idLast4.trim(),
      },
      answers: {
        group_pref: groupPref,
        weekly_freq: weeklyFreq.trim(),
        longest_run: longestRun.trim(),
      },
      disclaimer_accepted: agreed,
      proof_path: proofPath,
    });

    if (res.ok) {
      setDone(res.registration);
      scrollTop();
    } else {
      setError({ code: res.code, message: res.error });
      // 依錯誤碼把使用者帶回該修的步驟
      if (res.code === "DISCLAIMER_REQUIRED" || res.code === "VALIDATION") setStep(1);
      if (res.code === "PROOF_REQUIRED") setStep(3);
    }
    setPending(false);
    setSlow(false);
  }

  /* ================= 成功卡 ================= */
  if (done) {
    return (
      <div className="card-dark p-6 md:p-8">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">
          <CheckCircle2 size={15} /> 已提交
        </div>
        <h2 className="mt-3 text-xl font-black tracking-tight md:text-2xl">
          報名已提交，等待確認付款
        </h2>
        <p className="mt-3 break-words text-sm leading-relaxed text-white/70">
          報名已提交，等待確認付款。確認後會加 30 積分。
        </p>
        <p className="mt-2 break-words text-xs leading-relaxed text-white/55">
          管理員會在核對轉帳截圖後更新狀態。活動日前提早 10 分鐘到場報到。
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link
            href="/hyrox"
            className="btn-base btn-vital btn-slab min-h-11 w-full sm:w-auto"
          >
            返回 HYROX 主頁
          </Link>
          <Link
            href="/dashboard"
            className="btn-base btn-ghost btn-slab min-h-11 w-full sm:w-auto"
          >
            我的帳戶
          </Link>
        </div>
      </div>
    );
  }

  /* ================= 三步流程 ================= */
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (step === 3) void submit();
        else handleNext();
      }}
      className="min-w-0 space-y-5"
    >
      <StepIndicator current={step} />

      {/* 錯誤區：可讀訊息 + 依 code 的下一步 */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="slab border border-red-500/40 bg-red-500/10 px-4 py-3"
        >
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-red-300">
            <AlertCircle size={14} /> 未能提交
          </div>
          <p className="mt-2 break-words text-sm leading-relaxed text-red-200">
            {error.message}
          </p>
          {error.code === "ALREADY_REGISTERED" && (
            <Link
              href="/hyrox/register"
              className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-red-100 underline underline-offset-4"
            >
              重新整理查看報名狀態 <ExternalLink size={12} />
            </Link>
          )}
          {error.code === "UNAUTHENTICATED" && (
            <Link
              href="/login?next=/hyrox/register"
              className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-red-100 underline underline-offset-4"
            >
              重新登入 <ExternalLink size={12} />
            </Link>
          )}
          {error.code === "EVENT_CLOSED" && (
            <Link
              href="/hyrox"
              className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-red-100 underline underline-offset-4"
            >
              回 HYROX 主頁看下一場 <ExternalLink size={12} />
            </Link>
          )}
        </div>
      )}

      {/* ================= Step 1 ================= */}
      {step === 1 && (
        <section className="card-dark p-6 md:p-8">
          <h2 className="text-lg font-black tracking-tight">確認你的資料</h2>
          <p className="mt-1.5 break-words text-xs leading-relaxed text-white/55">
            這些資料會用於活動報名與保險登記。之後可以在「我的帳戶」修改。
          </p>

          {hasMissing && (
            <p
              role="alert"
              className="mt-4 break-words text-sm font-semibold text-red-300"
            >
              請先補齊：{missingKeys.map(fieldLabel).join("、")}
            </p>
          )}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <label className="label" htmlFor="full_name">
                姓名
              </label>
              <input
                id="full_name"
                name="full_name"
                type="text"
                autoComplete="name"
                maxLength={FULL_NAME_MAX}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                aria-invalid={missing.full_name || undefined}
                className={`field ${missing.full_name ? "border-red-500/70" : ""}`}
                placeholder="與身份證明文件相同"
              />
            </div>

            <div className="min-w-0">
              <label className="label" htmlFor="gender">
                性別
              </label>
              <select
                id="gender"
                name="gender"
                value={gender}
                onChange={(e) => setGender(e.target.value as Gender | "")}
                aria-invalid={missing.gender || undefined}
                className={`field ${missing.gender ? "border-red-500/70" : ""}`}
              >
                <option value="">請選擇</option>
                {GENDER_OPTIONS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-0">
              <label className="label" htmlFor="phone">
                電話
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={30}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={missing.phone || undefined}
                className={`field ${missing.phone ? "border-red-500/70" : ""}`}
                placeholder="例如 6612 3456"
              />
            </div>

            <div className="min-w-0">
              <label className="label" htmlFor="id_last4">
                身份證後四位
              </label>
              <input
                id="id_last4"
                name="id_last4"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                value={idLast4}
                onChange={(e) => setIdLast4(e.target.value)}
                aria-invalid={missing.id_last4 || undefined}
                aria-describedby="id_last4_hint"
                className={`field ${missing.id_last4 ? "border-red-500/70" : ""}`}
                placeholder="例如 1234"
              />
              <p
                id="id_last4_hint"
                className="mt-1.5 break-words text-[11px] leading-relaxed text-white/50"
              >
                只會儲存最後四位數字，用於活動報名及保險登記。
              </p>
            </div>
          </div>

          {/* 報名專屬三題 */}
          <div className="mt-8 border-t border-[var(--line-fine)] pt-6">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
              報名問題（只用於本次活動分組）
            </h3>

            <fieldset className="mt-4 min-w-0">
              <legend className="label">希望參與的組別？</legend>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {HYROX_GROUP_OPTIONS.map((g) => (
                  <label
                    key={g.value}
                    className={`flex min-h-11 cursor-pointer items-center gap-2.5 border px-3 py-2 text-sm transition ${
                      groupPref === g.value
                        ? "border-vital/60 bg-vital/10 text-white"
                        : "border-[var(--line-fine)] bg-white/[0.02] text-white/75 hover:border-white/30"
                    }`}
                  >
                    <input
                      type="radio"
                      name="group_pref"
                      value={g.value}
                      checked={groupPref === g.value}
                      onChange={() => setGroupPref(g.value)}
                      className="h-4 w-4 flex-none accent-[var(--color-vital)]"
                    />
                    <span className="min-w-0 break-words">{g.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <label className="label" htmlFor="weekly_freq">
                  請問您目前每週運動次數？（必填）
                </label>
                <input
                  id="weekly_freq"
                  name="weekly_freq"
                  type="text"
                  maxLength={200}
                  required
                  value={weeklyFreq}
                  onChange={(e) => setWeeklyFreq(e.target.value)}
                  className="field"
                  placeholder="例如 3 次"
                />
              </div>
              <div className="min-w-0">
                <label className="label" htmlFor="longest_run">
                  曾跑過最長的跑步距離？（必填）
                </label>
                <input
                  id="longest_run"
                  name="longest_run"
                  type="text"
                  maxLength={200}
                  required
                  value={longestRun}
                  onChange={(e) => setLongestRun(e.target.value)}
                  className="field"
                  placeholder="例如 10 公里"
                />
              </div>
            </div>
          </div>

          <div className="mt-7 flex justify-end">
            <button
              type="button"
              onClick={handleNext}
              className="btn-base btn-vital btn-slab min-h-11 w-full sm:w-auto"
            >
              下一步：免責聲明 <ArrowRight size={16} />
            </button>
          </div>
        </section>
      )}

      {/* ================= Step 2 ================= */}
      {step === 2 && (
        <section className="card-dark p-6 md:p-8">
          <h2 className="text-lg font-black tracking-tight">免責聲明</h2>
          <p className="mt-1.5 break-words text-xs leading-relaxed text-white/55">
            請完整讀一次。同意後才可進入付款步驟。
          </p>

          <div className="mt-4 border border-[var(--line-fine)] bg-black/25 p-4 md:p-5">
            <DisclaimerText />
          </div>

          <label className="mt-5 flex min-h-11 cursor-pointer items-start gap-3 border border-[var(--line-fine)] bg-white/[0.03] px-4 py-3">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 flex-none accent-[var(--color-vital)]"
              required
            />
            <span className="min-w-0 break-words text-sm leading-relaxed text-white/85">
              我已閱讀並同意上述免責聲明
            </span>
          </label>

          <p className="mt-3 break-words text-xs text-white/55">
            另外請參閱{" "}
            <Link
              href="/privacy"
              className="inline-flex min-h-11 items-center font-semibold text-vital-bright underline underline-offset-4 transition hover:text-white"
            >
              私隱政策
            </Link>
            。
          </p>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={() => goStep(1)}
              className="btn-base btn-ghost btn-slab min-h-11 w-full sm:w-auto"
            >
              <ArrowLeft size={16} /> 上一步
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={!agreed}
              className="btn-base btn-vital btn-slab min-h-11 w-full sm:w-auto disabled:cursor-not-allowed disabled:opacity-50"
            >
              下一步：付款 <ArrowRight size={16} />
            </button>
          </div>
          {!agreed && (
            <p className="mt-3 break-words text-right text-xs text-white/45">
              勾選「我已閱讀並同意」後才能繼續。
            </p>
          )}
        </section>
      )}

      {/* ================= Step 3 ================= */}
      {step === 3 && (
        <section className="card-dark p-6 md:p-8">
          <h2 className="text-lg font-black tracking-tight">付款</h2>

          <div className="mt-4 grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
            {/* 收款 QR／佔位框 */}
            <div className="min-w-0 sm:w-44">
              {qrUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrUrl}
                  alt="MSW 街健館收款 QR Code"
                  loading="lazy"
                  decoding="async"
                  className="w-full max-w-[220px] border border-[var(--line-fine)] bg-white object-contain p-2"
                />
              ) : (
                <div className="flex aspect-square w-full max-w-[220px] flex-col items-center justify-center gap-2 border border-dashed border-white/25 bg-black/30 px-3 text-center">
                  <span className="text-xs font-semibold text-white/70">
                    收款碼未上架
                  </span>
                  <span className="break-words text-[11px] leading-relaxed text-white/50">
                    請向管理員索取收款碼
                  </span>
                </div>
              )}
            </div>

            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
                MSW 街健館收款碼
              </p>
              <p className="stat-figure mt-2 break-words text-xl font-black text-white">
                費用：{feeLabel(event.fee_cents ?? 5000)}
              </p>
              <p className="mt-1 break-words text-xs text-white/60">
                （轉帳後請截圖上傳轉帳證明）
              </p>

              <div className="mt-4 space-y-1.5 border-t border-[var(--line-fine)] pt-4 text-sm">
                <p className="break-words text-white/75">
                  收款電話：
                  <span className="stat-figure ml-1 text-white">
                    {event.payment_phone ?? "請向管理員索取"}
                  </span>
                </p>
                {event.payment_note && (
                  <p className="break-words text-xs leading-relaxed text-white/55">
                    {event.payment_note}
                  </p>
                )}
              </div>

              <p className="mt-3 flex items-start gap-2 break-words text-xs leading-relaxed text-white/60">
                <Smartphone size={14} className="mt-0.5 flex-none text-vital-bright" />
                開啟「MPay」App 掃瞄上方 QR Code 轉賬
              </p>
            </div>
          </div>

          {/* 上傳區 */}
          <div className="mt-7 border-t border-[var(--line-fine)] pt-6">
            <label className="label" htmlFor="hyrox-proof">
              轉帳證明上傳
            </label>
            <p className="mb-2 break-words text-xs text-white/55">
              可上載 1 個檔案，大小上限為 10 MB
            </p>
            <ProofUploader
              value={proofPath}
              onChange={setProofPath}
              disabled={pending}
            />
          </div>

          {/* 提交 */}
          {pending && (
            <div
              role="status"
              aria-live="polite"
              className="slab mt-5 border border-cobalt/40 bg-cobalt/10 px-4 py-3"
            >
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-200">
                <Loader2 size={14} className="animate-spin" /> 正在提交報名
              </div>
              {slow && (
                <p className="mt-2 break-words text-xs text-blue-200/80">
                  網路較慢時會需要多一點時間，請保持頁面開啟不要關閉。
                </p>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={() => goStep(2)}
              disabled={pending}
              className="btn-base btn-ghost btn-slab min-h-11 w-full sm:w-auto"
            >
              <ArrowLeft size={16} /> 上一步
            </button>
            <button
              type="submit"
              disabled={!proofPath || pending}
              className="btn-base btn-vital btn-slab min-h-11 w-full sm:w-auto disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> 提交中…
                </>
              ) : (
                <>
                  <Send size={16} /> 提交報名
                </>
              )}
            </button>
          </div>
          {!proofPath && (
            <p className="mt-3 break-words text-right text-xs text-white/45">
              上傳轉帳截圖後才能提交。
            </p>
          )}
        </section>
      )}
    </form>
  );
}

/** 缺欄位提示用的中文名稱 */
function fieldLabel(key: string): string {
  switch (key) {
    case "full_name":
      return "姓名";
    case "gender":
      return "性別";
    case "phone":
      return "電話";
    case "id_last4":
      return "身份證後四位（4 位數字）";
    default:
      return key;
  }
}
