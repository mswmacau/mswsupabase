"use client";

/**
 * src/app/races/_components/RaceRegisterForm.tsx — 賽事報名表（三步、單頁）
 *
 * 為什麼是「單頁分步」而不是三條路由：
 *   手機上換路由會丟掉已填資料（或逼我們把草稿塞進 storage），
 *   而站主要求「3 分鐘內填完」，中途丟資料是最貴的錯誤。
 *   三步都在同一份 state 裡，上一步／下一步只是切換顯示。
 *
 * 契約（唯讀，不要改）：
 *   POST   /api/races/[id]/registrations        建立 → { ok, registration, entries }
 *   PATCH  /api/races/[id]/registrations        更新（entries 全量替換，status 回 submitted）
 *   POST   /api/races/[id]/registrations/proof  multipart，欄位名 file
 *   錯誤：{ ok:false, error, code, fields? } → fields 逐欄顯示在對應控件下方
 *
 * 【付款】只做兩件事：顯示賽事收款二維碼 + 上載截圖。不做任何金額合計、
 *   不代收、不跳轉支付。是否顯示付款區塊完全對齊後端 decidePaymentStatus：
 *   賽事層費用或所選組別費用任一 > 0 → 要付款。
 *
 * 【上載時機】/proof 要求「該場報名已存在」，所以：
 *   · 編輯模式（已有報名）→ 選檔即上載
 *   · 新增模式 → 先 POST 建報名，成功後才上載；上載失敗不影響報名成立，
 *     成功畫面上保留「重新上載」入口（不假裝成功）
 *
 * 無 JS 保護：三步全部渲染在 DOM，非當前步用 hidden；<noscript> 內把 hidden
 *   還原，所以 JS 失效時內容不會整塊隱形（站主硬要求）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  Upload,
} from "lucide-react";
import { useSmartNav } from "@/components/fx/useSmartNav";

/* =====================================================================
 * 型別（由 page.tsx 傳入）
 * ===================================================================== */

export type RegisterCategory = {
  id: string;
  name: string;
  /** "YYYY-MM-DD" */
  day: string;
  team_size: number;
  fee_cents: number;
};

export type RegisterEntry = {
  category_id: string;
  teammate_names: string | null;
};

export type RegisterInitial = {
  full_name: string;
  phone: string;
  gender: "male" | "female" | null;
  needs_bus: boolean;
  bus_seats: number;
  needs_lodging: boolean;
  lodging_people: number;
  lodging_nights: number;
  member_note: string;
  entries: RegisterEntry[];
  /** 已有付款截圖（編輯模式顯示「已上載」） */
  hasProof: boolean;
};

type Props = {
  eventId: string;
  /** events 沒有 slug 欄位，slug === id */
  eventSlug: string;
  eventTitle: string;
  mode: "create" | "edit";
  categories: RegisterCategory[];
  initial: RegisterInitial;
  /** 賽事層費用（分）；null = 讀不到 */
  feeCents: number | null;
  /** 收款二維碼完整網址；null = 站主沒設 */
  qrUrl: string | null;
};

type SuccessKind = "created" | "updated";

/* =====================================================================
 * 小工具
 * ===================================================================== */

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** "2026-11-20" → "11 月 20 日 · 週五"（手動解析，不經時區轉換） */
function dayLabel(iso: string): string {
  const hit = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!hit) return iso;
  const y = Number(hit[1]);
  const m = Number(hit[2]);
  const d = Number(hit[3]);
  const weekday = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m} 月 ${d} 日 · 週${weekday}`;
}

/** 分 → 「MOP 1,280」；0 → 「免費」 */
export function feeLabel(cents: number): string {
  if (!cents || cents <= 0) return "免費";
  const amount = cents / 100;
  const text = Number.isInteger(amount)
    ? amount.toLocaleString("en-US")
    : amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
  return `MOP ${text}`;
}

/** 以 code point 計長（中文／emoji 不算 2 個字，與後端同口徑） */
const cpLength = (s: string) => Array.from(s).length;

const NAME_MIN = 2;
const NAME_MAX = 60;
const PHONE_MIN = 6;
const PHONE_MAX = 20;
const PHONE_RE = /^[0-9+\- ]+$/;
const NOTE_MAX = 1000;
const MATE_MAX = 200;
const ENTRIES_MAX = 8;

const STEP_TITLES = ["個人資料", "參賽項目", "交通與住宿"] as const;

/** 每個欄位屬於哪一步（後端回 fields 時要跳回正確的一步） */
const FIELD_STEP: Record<string, 1 | 2 | 3> = {
  full_name: 1,
  phone: 1,
  gender: 1,
  entries: 2,
  needs_bus: 3,
  bus_seats: 3,
  needs_lodging: 3,
  lodging_people: 3,
  lodging_nights: 3,
  member_note: 3,
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* =====================================================================
 * 小型 UI 零件
 * ===================================================================== */

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-red-300"
    >
      <AlertCircle size={13} aria-hidden className="mt-0.5 flex-shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </p>
  );
}

/** toggle 開關：真的開關（role="switch"），不是 checkbox 造型 */
function Toggle({
  id,
  checked,
  label,
  onChange,
}: {
  id: string;
  checked: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center gap-3 text-left"
    >
      <span
        aria-hidden
        className={`relative flex h-7 w-12 flex-none items-center rounded-full border transition-colors ${
          checked
            ? "border-vital-bright bg-vital"
            : "border-white/25 bg-white/10"
        }`}
      >
        <span
          className={`absolute h-5 w-5 rounded-full bg-white transition-all ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </span>
      <span className="min-w-0 break-words text-sm font-semibold text-white">
        {label}
      </span>
    </button>
  );
}

function StepBar({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/50">
          第 {step} 步／共 3 步
        </p>
        <p className="mt-0.5 truncate text-sm font-bold text-white">
          {STEP_TITLES[step - 1]}
        </p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1.5" aria-hidden>
        {[1, 2, 3].map((n) => (
          <span
            key={n}
            className={`h-1.5 w-7 rounded-full ${
              n <= step ? "bg-vital-bright" : "bg-white/15"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/* =====================================================================
 * 主元件
 * ===================================================================== */

export function RaceRegisterForm({
  eventId,
  eventSlug,
  eventTitle,
  mode,
  categories,
  initial,
  feeCents,
  qrUrl,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  /* --- 表單值 --- */
  const [fullName, setFullName] = useState(initial.full_name);
  const [phone, setPhone] = useState(initial.phone);
  const [gender, setGender] = useState<"male" | "female" | null>(
    initial.gender
  );
  /** categoryId → 隊友名（空字串＝有選但沒填） */
  const [selected, setSelected] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const e of initial.entries) map[e.category_id] = e.teammate_names ?? "";
    return map;
  });
  const [needsBus, setNeedsBus] = useState(initial.needs_bus);
  const [busSeats, setBusSeats] = useState(
    String(initial.bus_seats > 0 ? initial.bus_seats : 1)
  );
  const [needsLodging, setNeedsLodging] = useState(initial.needs_lodging);
  const [lodgingPeople, setLodgingPeople] = useState(
    String(initial.lodging_people > 0 ? initial.lodging_people : 1)
  );
  const [lodgingNights, setLodgingNights] = useState(
    String(initial.lodging_nights > 0 ? initial.lodging_nights : 1)
  );
  const [memberNote, setMemberNote] = useState(initial.member_note);

  /* --- 狀態 --- */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessKind | null>(null);

  /* --- 付款截圖 --- */
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [proofDone, setProofDone] = useState(initial.hasProof);
  const [proofError, setProofError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  /* 導覽列會在下滑時收起；步驟指示器跟著貼齊，避免留一條空隙 */
  const navHidden = useSmartNav();

  const selectedIds = useMemo(() => Object.keys(selected), [selected]);
  const categoryById = useMemo(() => {
    const m = new Map<string, RegisterCategory>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  /** 與後端 decidePaymentStatus 同口徑 */
  const needsPayment = useMemo(
    () =>
      (feeCents ?? 0) > 0 ||
      selectedIds.some((id) => (categoryById.get(id)?.fee_cents ?? 0) > 0),
    [feeCents, selectedIds, categoryById]
  );

  const grouped = useMemo(() => {
    const byDay = new Map<string, RegisterCategory[]>();
    for (const c of categories) {
      const list = byDay.get(c.day) ?? [];
      list.push(c);
      byDay.set(c.day, list);
    }
    return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }, [categories]);

  /* ------------------------------------------------------------------
   * 驗證（與後端 parseRegistrationBody 同口徑，先擋一次避免白跑）
   * ------------------------------------------------------------------ */

  const validateStep1 = useCallback((): Record<string, string> => {
    const errs: Record<string, string> = {};
    const name = fullName.trim();
    if (!name) errs.full_name = "請填寫姓名。";
    else if (cpLength(name) < NAME_MIN || cpLength(name) > NAME_MAX)
      errs.full_name = `姓名需 ${NAME_MIN} 到 ${NAME_MAX} 個字。`;

    const tel = phone.trim();
    if (!tel) errs.phone = "請填寫聯絡電話。";
    else if (tel.length < PHONE_MIN || tel.length > PHONE_MAX)
      errs.phone = `電話需 ${PHONE_MIN} 到 ${PHONE_MAX} 個字元。`;
    else if (!PHONE_RE.test(tel))
      errs.phone = "電話只能包含數字、+、- 與空格。";

    if (!gender) errs.gender = "請選擇性別。";
    return errs;
  }, [fullName, phone, gender]);

  const validateStep2 = useCallback((): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (selectedIds.length === 0) errs.entries = "請至少選一個組別。";
    else if (selectedIds.length > ENTRIES_MAX)
      errs.entries = `一次最多只能報 ${ENTRIES_MAX} 個組別。`;
    return errs;
  }, [selectedIds]);

  const validateStep3 = useCallback((): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (needsBus) {
      const seats = Number(busSeats);
      if (!Number.isInteger(seats) || seats < 1 || seats > 20)
        errs.bus_seats = "座位數必須介於 1 到 20。";
    }
    if (needsLodging) {
      const people = Number(lodgingPeople);
      if (!Number.isInteger(people) || people < 1 || people > 20)
        errs.lodging_people = "人數必須介於 1 到 20。";
      const nights = Number(lodgingNights);
      if (!Number.isInteger(nights) || nights < 1 || nights > 30)
        errs.lodging_nights = "晚數必須介於 1 到 30。";
    }
    if (cpLength(memberNote) > NOTE_MAX)
      errs.member_note = `備註最多 ${NOTE_MAX} 個字。`;
    return errs;
  }, [needsBus, busSeats, needsLodging, lodgingPeople, lodgingNights, memberNote]);

  /** 把錯誤顯示出來並跳到「第一個錯誤所在的那一步」 */
  const showErrors = useCallback((errs: Record<string, string>) => {
    setFieldErrors(errs);
    const first = Object.keys(errs)[0];
    if (!first) return;
    const target = FIELD_STEP[first] ?? 1;
    setStep(target);
    window.requestAnimationFrame(() => {
      const el = document.getElementById(`reg-${first}`);
      if (!el) return;
      el.scrollIntoView({
        block: "center",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.focus({ preventScroll: true });
      }
    });
  }, []);

  /* ------------------------------------------------------------------
   * 付款截圖上載
   * ------------------------------------------------------------------ */

  const uploadProof = useCallback(
    async (file: File): Promise<boolean> => {
      setProofBusy(true);
      setProofError(null);
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(
          `/api/races/${eventId}/registrations/proof`,
          { method: "POST", body: fd, signal: ac.signal }
        );
        const json: unknown = await res.json().catch(() => null);
        const ok =
          typeof json === "object" && json !== null && (json as { ok?: unknown }).ok === true;
        if (!res.ok || !ok) {
          const message =
            typeof json === "object" && json !== null
              ? String((json as { error?: unknown }).error ?? "")
              : "";
          setProofError(message || "上載失敗，請稍後再試。");
          return false;
        }
        setProofDone(true);
        return true;
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return false;
        setProofError("網絡不穩，上載失敗，請重試。");
        return false;
      } finally {
        setProofBusy(false);
      }
    },
    [eventId]
  );

  const onPickFile = useCallback(
    async (file: File | null) => {
      setProofError(null);
      if (!file) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setProofError("只接受 JPG／PNG／WebP 圖片。");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setProofError("圖片不可超過 5MB，請壓縮後再上載。");
        return;
      }
      setProofFile(file);
      // 編輯模式：報名已存在 → 可以立即上載
      if (mode === "edit") await uploadProof(file);
    },
    [mode, uploadProof]
  );

  /* ------------------------------------------------------------------
   * 送出
   * ------------------------------------------------------------------ */

  const buildBody = useCallback(
    () => ({
      full_name: fullName.trim(),
      phone: phone.trim(),
      gender,
      needs_bus: needsBus,
      bus_seats: needsBus ? Number(busSeats) : 0,
      needs_lodging: needsLodging,
      lodging_people: needsLodging ? Number(lodgingPeople) : 0,
      lodging_nights: needsLodging ? Number(lodgingNights) : 0,
      member_note: memberNote.trim(),
      entries: selectedIds.map((id) => ({
        category_id: id,
        teammate_names: (selected[id] ?? "").trim() || null,
      })),
    }),
    [
      fullName,
      phone,
      gender,
      needsBus,
      busSeats,
      needsLodging,
      lodgingPeople,
      lodgingNights,
      memberNote,
      selectedIds,
      selected,
    ]
  );

  const onSubmit = useCallback(async () => {
    setFormError(null);
    const errs = {
      ...validateStep1(),
      ...validateStep2(),
      ...validateStep3(),
    };
    if (Object.keys(errs).length > 0) {
      showErrors(errs);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(`/api/races/${eventId}/registrations`, {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
        signal: ac.signal,
      });
      const json: unknown = await res.json().catch(() => null);
      const ok =
        typeof json === "object" && json !== null && (json as { ok?: unknown }).ok === true;

      if (!res.ok || !ok) {
        const fields =
          typeof json === "object" && json !== null
            ? ((json as { fields?: unknown }).fields as
                | Record<string, string>
                | undefined)
            : undefined;
        if (fields && Object.keys(fields).length > 0) {
          showErrors(fields);
          return;
        }
        const message =
          typeof json === "object" && json !== null
            ? String((json as { error?: unknown }).error ?? "")
            : "";
        setFormError(message || "提交失敗，請稍後再試。");
        return;
      }

      // 新增模式：報名已建立，這時才上載（/proof 需要報名存在）
      if (mode === "create" && proofFile) await uploadProof(proofFile);
      setSuccess(mode === "edit" ? "updated" : "created");
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setFormError("網絡不穩，提交失敗，請重試。");
    } finally {
      setSubmitting(false);
    }
  }, [
    eventId,
    mode,
    proofFile,
    uploadProof,
    validateStep1,
    validateStep2,
    validateStep3,
    showErrors,
    buildBody,
  ]);

  const goNext = useCallback(() => {
    if (step === 1) {
      const errs = validateStep1();
      if (Object.keys(errs).length > 0) {
        showErrors(errs);
        return;
      }
      setFieldErrors({});
      setStep(2);
      return;
    }
    if (step === 2) {
      const errs = validateStep2();
      if (Object.keys(errs).length > 0) {
        showErrors(errs);
        return;
      }
      setFieldErrors({});
      setStep(3);
    }
  }, [step, validateStep1, validateStep2, showErrors]);

  /* ------------------------------------------------------------------
   * 成功畫面（不是 alert）
   * ------------------------------------------------------------------ */

  if (success) {
    const entryNames = selectedIds
      .map((id) => categoryById.get(id)?.name)
      .filter((n): n is string => Boolean(n));
    return (
      <div className="card-dark mt-5 p-5 md:p-7">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={20} aria-hidden className="flex-shrink-0 text-emerald-300" />
          <h2 className="text-lg font-black tracking-tight text-white">
            {success === "created" ? "已提交，待教練確認" : "已更新，待教練重新確認"}
          </h2>
        </div>

        <dl className="mt-5 space-y-2.5 border-t border-white/10 pt-4 text-sm">
          <div className="flex gap-3">
            <dt className="w-16 flex-shrink-0 text-white/50">賽事</dt>
            <dd className="min-w-0 break-words font-semibold text-white">
              {eventTitle}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-16 flex-shrink-0 text-white/50">參賽項目</dt>
            <dd className="min-w-0 break-words text-white/85">
              {entryNames.length > 0 ? entryNames.join("、") : "—"}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-16 flex-shrink-0 text-white/50">巴士</dt>
            <dd className="min-w-0 break-words text-white/85">
              {needsBus ? `${busSeats} 位` : "不需要"}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-16 flex-shrink-0 text-white/50">住宿</dt>
            <dd className="min-w-0 break-words text-white/85">
              {needsLodging
                ? `${lodgingPeople} 人 ${lodgingNights} 晚`
                : "不需要"}
            </dd>
          </div>
          {needsPayment && (
            <div className="flex gap-3">
              <dt className="w-16 flex-shrink-0 text-white/50">付款截圖</dt>
              <dd className="min-w-0 break-words text-white/85">
                {proofDone ? "已上載，待管理員確認" : "未上載"}
              </dd>
            </div>
          )}
        </dl>

        {needsPayment && !proofDone && (
          <div className="mt-4 border-l-2 border-amber-400/60 bg-amber-400/[0.07] px-4 py-3">
            <p className="text-sm leading-relaxed text-amber-100/85">
              報名已送出，但付款截圖尚未上載成功。
              {proofError ? `（${proofError}）` : ""}
            </p>
            <div className="mt-3">
              <label
                htmlFor="reg-proof-retry"
                className="mb-1.5 block text-xs font-semibold text-white/70"
              >
                重新上載付款截圖
              </label>
              <input
                id="reg-proof-retry"
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={proofBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  void onPickFile(f);
                }}
                className="block w-full text-sm text-white/70 file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-full file:border-0 file:bg-white/10 file:px-4 file:text-sm file:font-semibold file:text-white"
              />
              {proofBusy && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-white/60">
                  <Loader2 size={13} aria-hidden className="animate-spin" />
                  上載中…
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link
            href="/dashboard"
            className="btn-base btn-vital btn-slab min-h-11 w-full text-sm sm:w-auto"
          >
            查看我的報名
            <ArrowRight size={15} aria-hidden />
          </Link>
          <Link
            href={`/races/${eventSlug}`}
            className="btn-base btn-ghost btn-slab min-h-11 w-full text-sm sm:w-auto"
          >
            返回賽事頁
          </Link>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------
   * 表單本體
   * ------------------------------------------------------------------ */

  const inputCls = (field: string) =>
    `field min-h-11 scroll-mt-32 ${fieldErrors[field] ? "border-red-400/70" : ""}`;

  return (
    <div className="mt-5" data-race-form="">
      {/* 無 JS：把被 hidden 的步驟還原，內容不得隱形 */}
      <noscript>
        <style>{`.reg-step[hidden]{display:block!important}`}</style>
      </noscript>

      {/* 步驟指示器：固定在頂部（導覽列收起時貼齊 0） */}
      <div
        className={`sticky z-40 -mx-5 border-b border-white/10 bg-ink/95 px-5 py-3 backdrop-blur transition-[top] duration-300 md:-mx-6 md:px-6 ${
          navHidden ? "top-0" : "top-16 md:top-20"
        }`}
      >
        <StepBar step={step} />
      </div>
      <p aria-live="polite" className="sr-only">
        第 {step} 步，共 3 步：{STEP_TITLES[step - 1]}
      </p>

      {/* ===== 第 1 步：個人資料 ===== */}
      <section
        className="reg-step mt-6"
        hidden={step !== 1}
        aria-labelledby="reg-step1-title"
      >
        <h2 id="reg-step1-title" className="text-base font-black text-white">
          個人資料
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-white/55">
          賽事分組與保險要用，請填真實姓名。
        </p>

        <div className="mt-5">
          <label htmlFor="reg-full_name" className="label">
            姓名 <span className="text-vital-bright">*</span>
          </label>
          <input
            id="reg-full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            maxLength={NAME_MAX}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            aria-invalid={Boolean(fieldErrors.full_name)}
            aria-describedby={
              fieldErrors.full_name ? "reg-err-full_name" : undefined
            }
            className={inputCls("full_name")}
          />
          <FieldError id="reg-err-full_name" message={fieldErrors.full_name} />
        </div>

        <div className="mt-4">
          <label htmlFor="reg-phone" className="label">
            聯絡電話 <span className="text-vital-bright">*</span>
          </label>
          <input
            id="reg-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={PHONE_MAX}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={Boolean(fieldErrors.phone)}
            aria-describedby={fieldErrors.phone ? "reg-err-phone" : undefined}
            className={inputCls("phone")}
          />
          <FieldError id="reg-err-phone" message={fieldErrors.phone} />
        </div>

        <div className="mt-4">
          <span id="reg-gender-label" className="label">
            性別 <span className="text-vital-bright">*</span>
          </span>
          <div
            id="reg-gender"
            role="radiogroup"
            aria-labelledby="reg-gender-label"
            className="grid grid-cols-2 gap-2.5"
          >
            {(
              [
                { value: "male", text: "男" },
                { value: "female", text: "女" },
              ] as const
            ).map((opt) => {
              const on = gender === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setGender(opt.value)}
                  className={`flex min-h-16 items-center justify-center gap-2 border text-base font-bold transition-colors ${
                    on
                      ? "border-vital-bright bg-vital/20 text-white"
                      : "border-white/15 bg-white/[0.03] text-white/75"
                  }`}
                >
                  {on && <Check size={16} aria-hidden className="flex-shrink-0" />}
                  {opt.text}
                </button>
              );
            })}
          </div>
          <FieldError id="reg-err-gender" message={fieldErrors.gender} />
        </div>
      </section>

      {/* ===== 第 2 步：參賽項目 ===== */}
      <section
        className="reg-step mt-6"
        hidden={step !== 2}
        aria-labelledby="reg-step2-title"
      >
        <h2 id="reg-step2-title" className="text-base font-black text-white">
          參賽項目
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-white/55">
          可選多項，已選 {selectedIds.length} 項。
        </p>

        <div id="reg-entries">
          <FieldError id="reg-err-entries" message={fieldErrors.entries} />
        </div>

        {grouped.length === 0 ? (
          <div className="slab mt-4 border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/70">
            這場賽事暫未公佈組別，請稍後再試或聯絡教練。
          </div>
        ) : (
          <div className="mt-4 space-y-6">
            {grouped.map(([day, list]) => (
              <div key={day}>
                <p className="tnum text-[12px] font-bold tracking-wide text-vital-bright">
                  {dayLabel(day)}
                </p>
                <div className="mt-2 space-y-2.5">
                  {list.map((c) => {
                    const on = c.id in selected;
                    return (
                      <div
                        key={c.id}
                        className={`border transition-colors ${
                          on
                            ? "border-vital-bright/70 bg-vital/[0.1]"
                            : "border-white/12 bg-white/[0.03]"
                        }`}
                      >
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          onClick={() =>
                            setSelected((prev) => {
                              const next = { ...prev };
                              if (c.id in next) delete next[c.id];
                              else next[c.id] = "";
                              return next;
                            })
                          }
                          className="flex min-h-16 w-full items-center gap-3 px-3.5 py-3 text-left"
                        >
                          <span
                            aria-hidden
                            className={`flex h-5 w-5 flex-none items-center justify-center border ${
                              on
                                ? "border-vital-bright bg-vital text-white"
                                : "border-white/30 text-transparent"
                            }`}
                          >
                            <Check size={13} strokeWidth={3} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-sm font-semibold text-white">
                              {c.name}
                            </span>
                            <span className="mt-0.5 block text-xs text-white/55">
                              {c.team_size > 1
                                ? `${c.team_size} 人一組`
                                : "個人項目"}{" "}
                              · {feeLabel(c.fee_cents)}
                            </span>
                          </span>
                        </button>

                        {on && c.team_size > 1 && (
                          <div className="border-t border-white/10 px-3.5 py-3">
                            <label
                              htmlFor={`reg-mate-${c.id}`}
                              className="label"
                            >
                              隊友名（選填）
                            </label>
                            <input
                              id={`reg-mate-${c.id}`}
                              type="text"
                              maxLength={MATE_MAX}
                              value={selected[c.id] ?? ""}
                              onChange={(e) =>
                                setSelected((prev) => ({
                                  ...prev,
                                  [c.id]: e.target.value,
                                }))
                              }
                              placeholder="多人項目請填隊友姓名"
                              className="field min-h-11 scroll-mt-32"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ===== 第 3 步：交通與住宿 ===== */}
      <section
        className="reg-step mt-6"
        hidden={step !== 3}
        aria-labelledby="reg-step3-title"
      >
        <h2 id="reg-step3-title" className="text-base font-black text-white">
          交通與住宿
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-white/55">
          由教練統一安排，不接受現場臨時加位。
        </p>

        <div className="mt-5 border border-white/12 bg-white/[0.03] px-3.5 py-3">
          <Toggle
            id="reg-needs_bus"
            checked={needsBus}
            label="需要來回巴士接送"
            onChange={setNeedsBus}
          />
          {needsBus && (
            <div className="mt-3 border-t border-white/10 pt-3">
              <label htmlFor="reg-bus_seats" className="label">
                座位數
              </label>
              <input
                id="reg-bus_seats"
                type="number"
                inputMode="numeric"
                min={1}
                max={20}
                step={1}
                value={busSeats}
                onChange={(e) => setBusSeats(e.target.value)}
                onBlur={() => {
                  const n = Number(busSeats);
                  setBusSeats(
                    String(
                      Number.isInteger(n) && n >= 1 && n <= 20
                        ? n
                        : initial.bus_seats > 0
                          ? initial.bus_seats
                          : 1
                    )
                  );
                }}
                aria-invalid={Boolean(fieldErrors.bus_seats)}
                aria-describedby={
                  fieldErrors.bus_seats ? "reg-err-bus_seats" : undefined
                }
                className={inputCls("bus_seats")}
              />
              <FieldError
                id="reg-err-bus_seats"
                message={fieldErrors.bus_seats}
              />
            </div>
          )}
        </div>

        <div className="mt-3 border border-white/12 bg-white/[0.03] px-3.5 py-3">
          <Toggle
            id="reg-needs_lodging"
            checked={needsLodging}
            label="需要代訂住宿"
            onChange={setNeedsLodging}
          />
          {needsLodging && (
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/10 pt-3">
              <div className="min-w-0">
                <label htmlFor="reg-lodging_people" className="label">
                  人數
                </label>
                <input
                  id="reg-lodging_people"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={20}
                  step={1}
                  value={lodgingPeople}
                  onChange={(e) => setLodgingPeople(e.target.value)}
                  onBlur={() => {
                    const n = Number(lodgingPeople);
                    setLodgingPeople(
                      String(
                        Number.isInteger(n) && n >= 1 && n <= 20
                          ? n
                          : initial.lodging_people > 0
                            ? initial.lodging_people
                            : 1
                      )
                    );
                  }}
                  aria-invalid={Boolean(fieldErrors.lodging_people)}
                  aria-describedby={
                    fieldErrors.lodging_people
                      ? "reg-err-lodging_people"
                      : undefined
                  }
                  className={inputCls("lodging_people")}
                />
                <FieldError
                  id="reg-err-lodging_people"
                  message={fieldErrors.lodging_people}
                />
              </div>
              <div className="min-w-0">
                <label htmlFor="reg-lodging_nights" className="label">
                  晚數
                </label>
                <input
                  id="reg-lodging_nights"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={30}
                  step={1}
                  value={lodgingNights}
                  onChange={(e) => setLodgingNights(e.target.value)}
                  onBlur={() => {
                    const n = Number(lodgingNights);
                    setLodgingNights(
                      String(
                        Number.isInteger(n) && n >= 1 && n <= 30
                          ? n
                          : initial.lodging_nights > 0
                            ? initial.lodging_nights
                            : 1
                      )
                    );
                  }}
                  aria-invalid={Boolean(fieldErrors.lodging_nights)}
                  aria-describedby={
                    fieldErrors.lodging_nights
                      ? "reg-err-lodging_nights"
                      : undefined
                  }
                  className={inputCls("lodging_nights")}
                />
                <FieldError
                  id="reg-err-lodging_nights"
                  message={fieldErrors.lodging_nights}
                />
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <label htmlFor="reg-member_note" className="label">
            備註（選填）
          </label>
          <textarea
            id="reg-member_note"
            rows={3}
            maxLength={NOTE_MAX}
            value={memberNote}
            onChange={(e) => setMemberNote(e.target.value)}
            aria-invalid={Boolean(fieldErrors.member_note)}
            aria-describedby={
              fieldErrors.member_note ? "reg-err-member_note" : undefined
            }
            className={`${inputCls("member_note")} min-h-[88px]`}
          />
          <FieldError id="reg-err-member_note" message={fieldErrors.member_note} />
        </div>

        {/* 付款：只有真的要付費才出現 */}
        {needsPayment && (
          <div className="mt-6 border border-white/12 bg-white/[0.03] px-4 py-4">
            <h3 className="text-sm font-black text-white">付款</h3>
            {qrUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={qrUrl}
                alt="付款二維碼"
                width={220}
                height={220}
                className="mt-3 h-[220px] w-[220px] bg-white object-contain p-2"
              />
            ) : null}
            <p className="mt-3 text-[13px] leading-relaxed text-white/60">
              請依以上方式付款，完成後上載截圖。管理員核對後會更新狀態。
            </p>

            {proofDone ? (
              <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
                <CheckCircle2 size={15} aria-hidden className="flex-shrink-0" />
                已上載，待管理員確認
              </p>
            ) : (
              <div className="mt-3">
                <label
                  htmlFor="reg-proof"
                  className="mb-1.5 block text-xs font-semibold text-white/70"
                >
                  上載付款截圖
                </label>
                <input
                  id="reg-proof"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={proofBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    void onPickFile(f);
                  }}
                  className="block w-full text-sm text-white/70 file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-full file:border-0 file:bg-white/10 file:px-4 file:text-sm file:font-semibold file:text-white"
                />
                <p className="mt-1.5 text-[11px] text-white/45">
                  JPG／PNG／WebP，最大 5MB。
                  {mode === "create" ? "送出報名後一併上載。" : ""}
                </p>
                {proofBusy && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-white/60">
                    <Loader2 size={13} aria-hidden className="animate-spin" />
                    上載中…
                  </p>
                )}
                {proofError && (
                  <p
                    role="alert"
                    className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-red-300"
                  >
                    <AlertCircle
                      size={13}
                      aria-hidden
                      className="mt-0.5 flex-shrink-0"
                    />
                    <span className="min-w-0 break-words">{proofError}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ===== 總錯誤 ===== */}
      {formError && (
        <div
          role="alert"
          className="mt-5 flex items-start gap-2 border-l-2 border-red-500/70 bg-red-500/10 px-4 py-3"
        >
          <AlertCircle size={15} aria-hidden className="mt-0.5 flex-shrink-0 text-red-300" />
          <p className="min-w-0 break-words text-sm leading-relaxed text-red-200">
            {formError}
          </p>
        </div>
      )}

      {/* ===== 底部固定操作列 =====
          z-40 與步驟指示器同層：滾到表單盡頭時兩者會錯身而過，
          同層 + DOM 在後 → 操作列永遠壓在上面，不會被指示器蓋住點不到。 */}
      <div className="sticky bottom-0 z-40 -mx-5 mt-6 border-t border-white/15 bg-ink px-5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 md:-mx-6 md:px-6">
        <div className="flex gap-2.5">
          {step > 1 && (
            <button
              type="button"
              onClick={() => {
                setFormError(null);
                setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s));
              }}
              disabled={submitting}
              className="btn-base btn-ghost btn-slab min-h-12 flex-none px-5 text-sm"
            >
              <ArrowLeft size={16} aria-hidden />
              上一步
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              onClick={goNext}
              className="btn-base btn-vital btn-slab min-h-12 min-w-0 flex-1 text-sm"
            >
              下一步
              <ArrowRight size={16} aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onSubmit()}
              disabled={submitting || proofBusy}
              className="btn-base btn-vital btn-slab min-h-12 min-w-0 flex-1 text-sm"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} aria-hidden className="animate-spin" />
                  提交中…
                </>
              ) : (
                <>
                  <Upload size={16} aria-hidden />
                  {mode === "edit" ? "儲存修改" : "提交報名"}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
