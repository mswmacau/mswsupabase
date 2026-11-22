"use client";

/**
 * src/components/hyrox/ResultSubmitForm.tsx — HYROX 完賽成績提交（F-02）
 *
 * 骨架：逐段複製 src/app/run/RunUploadForm.tsx 的兩段 Stage
 * （idle → upload → submit）：選圖後 canvas 壓縮直傳 run-screenshots，
 * 只把 image_path 以 JSON POST /api/hyrox/results（契約 §1.5-①）。
 *
 * 上傳 kind 用既有的 "payment"：src/lib/upload.ts 的 payment 分支
 * ＝私有桶 run-screenshots ＋ `{uid}/` 路徑前綴，與方案 P-5「重用
 * run-screenshots、目錄＝auth.uid()」完全同一套；upload.ts 在
 * src/lib/（後端檔案範圍），不為此加新 kind。
 *
 * 欄位與錯誤文案全部來自方案 §5 凍結清單（逐字，不得改寫）。
 * 欄位級錯誤一次收集 → 顯示在對應欄位下 → 自動滾到第一個錯誤；
 * API 端的欄位級錯誤（錯誤信封 fields）也走同一套顯示與滾動。
 *
 * Hydration：比賽日期的 max 屬性在 useEffect 補（server / client
 * 首次 render 都不含 max，不會 mismatch）。
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ImagePlus,
  Loader2,
  UploadCloud,
  X,
} from "lucide-react";
import { RULES } from "@/lib/config";
import { todayISO } from "@/lib/utils";
import { uploadImageFile } from "@/lib/upload";
import { FetchError, postJson } from "@/lib/fetch-json";

/**
 * 類別選項的最小形狀。本檔自帶（不 import @/lib/types）：
 * 白客 B-03 的 HyroxDivision 是這個形狀的超集，結構相容可直接傳入，
 * 元件本身對後端 commit 順序零依賴。
 */
export interface ResultDivisionOption {
  code: string;
  label: string;
  /** 每隊人數：1 單人 / 2 雙人 / 4 四人 */
  team_size: number;
}

/** 上傳階段（同 RunUploadForm：讓進度有層次，不是只有轉圈） */
type Stage = "idle" | "upload" | "submit";

const STAGE_TEXT: Record<Exclude<Stage, "idle">, { step: string; title: string }> = {
  upload: { step: "Step 01 / 02", title: "壓縮並上傳截圖" },
  submit: { step: "Step 02 / 02", title: "送出成績至後台" },
};

/** 欄位級錯誤的鍵（也決定「滾到第一個錯誤」的順序，與頁面欄位順序一致） */
type FieldKey =
  | "division_code"
  | "finish_time"
  | "race_name"
  | "race_date"
  | "team_name"
  | "teammates"
  | "image_path";

const FIELD_ORDER: FieldKey[] = [
  "division_code",
  "finish_time",
  "race_name",
  "race_date",
  "team_name",
  "teammates",
  "image_path",
];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 完賽時間邊界（與 API／DB check 同口徑：60–86399 秒） */
const MIN_SECONDS = 60;
const MAX_SECONDS = 86399;

export function ResultSubmitForm({
  divisions,
}: {
  divisions: ResultDivisionOption[];
}) {
  const router = useRouter();

  const [division, setDivision] = useState<ResultDivisionOption | null>(null);
  const [hh, setHh] = useState(0);
  const [mm, setMm] = useState(0);
  const [ss, setSs] = useState(0);
  const [raceName, setRaceName] = useState("");
  const [raceDate, setRaceDate] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teammates, setTeammates] = useState<string[]>([]);
  const [note, setNote] = useState("");

  const [pending, setPending] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [success, setSuccess] = useState<string | null>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // 比賽日期上限（不可晚於今天）在 effect 補 DOM 屬性：server / client
  // 首次 render 都不含 max → 無 hydration mismatch；驗證時在事件處理器
  // 另以 todayISO() 即時計（同 API 口徑，澳門時區）。
  useEffect(() => {
    dateInputRef.current?.setAttribute("max", todayISO());
  }, []);

  const teamSize = division?.team_size ?? 1;
  const isTeam = teamSize > 1;

  // 釋放 preview 的 object URL（記憶體）
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  // 超過 3 秒改給文字說明（同 RunUploadForm）
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [pending]);

  /** 每個欄位容器的錨點 id（滾到第一個錯誤用；不用 useRef map，
      事件處理器直接以 id 取元素，避開 render 期間讀 ref） */
  const anchorId = (key: FieldKey) => `result-field-${key}`;

  /** 選類別：隊伍欄位依 team_size 重建；單人把殘留值清掉 */
  function pickDivision(d: ResultDivisionOption) {
    setDivision(d);
    if (d.team_size > 1) {
      setTeammates(Array.from({ length: d.team_size - 1 }, () => ""));
    } else {
      setTeamName("");
      setTeammates([]);
    }
    setFieldErrors((prev) => ({ ...prev, division_code: undefined }));
  }

  /** 把錯誤顯示到對應欄位，並滾到第一個錯誤（§1.6：錯誤自動滾到第一個） */
  function showFieldErrors(next: Partial<Record<FieldKey, string>>) {
    setFieldErrors(next);
    const first = FIELD_ORDER.find((k) => typeof next[k] === "string");
    if (!first) return;
    const el = document.getElementById(anchorId(first));
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    // 焦點移到欄位內第一個可 focus 元素，鍵盤／讀屏使用者不用再找
    el?.querySelector<HTMLElement>("input,select,button")?.focus({ preventScroll: true });
  }

  /** 前端先驗一次（凍結文案 §5-6）；API 端照樣再驗（契約行為不變） */
  function validate(): Partial<Record<FieldKey, string>> {
    const errs: Partial<Record<FieldKey, string>> = {};
    if (!division) errs.division_code = "請選擇比賽類別。";

    const seconds = hh * 3600 + mm * 60 + ss;
    const timeOk =
      Number.isInteger(hh) &&
      Number.isInteger(mm) &&
      Number.isInteger(ss) &&
      hh >= 0 &&
      hh <= 23 &&
      mm >= 0 &&
      mm <= 59 &&
      ss >= 0 &&
      ss <= 59 &&
      seconds >= MIN_SECONDS &&
      seconds <= MAX_SECONDS;
    if (!timeOk) errs.finish_time = "請填寫有效的完賽時間。";

    const rn = raceName.trim();
    if (rn.length < 1 || rn.length > 80) errs.race_name = "請填寫賽事名稱。";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate) || raceDate > todayISO()) {
      errs.race_date = "請填寫有效的比賽日期。";
    }

    if (division && division.team_size > 1) {
      if (teamName.trim().length < 1) errs.team_name = "這個類別需要填寫隊伍名稱。";
      const need = division.team_size - 1;
      const filled = teammates.filter((t) => t.trim().length >= 1 && t.trim().length <= 40);
      if (filled.length !== need) errs.teammates = "隊友人數與所選類別不符，請檢查。";
    }

    if (!selectedFile) errs.image_path = "請重新上傳完賽證明截圖。";

    return errs;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return; // 防重

    setError(null);
    setSuccess(null);

    const errs = validate();
    if (Object.keys(errs).length > 0) {
      showFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    setPending(true);
    setSlow(false);
    setStage("upload");
    try {
      // 1) 壓縮 → 直傳 Storage，回傳 image_path（同 RunUploadForm）
      const imagePath = await uploadImageFile(selectedFile!, "payment");

      // 2) 只把資料以 JSON 送 API（契約 §1.5-① 欄位名逐字）
      setStage("submit");
      await postJson<{ ok: true; message?: string }>("/api/hyrox/results", {
        division_code: division!.code,
        finish_time: `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`,
        race_name: raceName.trim(),
        race_date: raceDate,
        team_name: isTeam ? teamName.trim() : null,
        teammates: isTeam ? teammates.map((t) => t.trim()) : [],
        image_path: imagePath,
        note: note.trim() === "" ? null : note.trim(),
      });

      // 凍結文案 §5-5：完成訊息
      setSuccess("已提交，等待後台確認。");
      resetForm();
      router.refresh();
    } catch (err) {
      if (err instanceof FetchError) {
        // 欄位級錯誤（API 錯誤信封 fields）→ 顯示到欄位下並滾到第一個
        if (err.fields && Object.keys(err.fields).length > 0) {
          const api: Partial<Record<FieldKey, string>> = {};
          for (const k of FIELD_ORDER) {
            if (typeof err.fields[k] === "string") {
              api[k] = err.fields[k] as string;
            }
          }
          if (Object.keys(api).length > 0) {
            showFieldErrors(api);
            return;
          }
        }
        // 其他（409 重複／401 未登入／400 尚未開放…）→ 頂部橫幅
        setError(err.message);
      } else {
        setError("提交失敗，請稍後再試。");
      }
    } finally {
      setPending(false);
      setSlow(false);
      setStage("idle");
    }
  }

  function resetForm() {
    setDivision(null);
    setHh(0);
    setMm(0);
    setSs(0);
    setRaceName("");
    setRaceDate("");
    setTeamName("");
    setTeammates([]);
    setNote("");
    setPreview(null);
    setFileName("");
    setSelectedFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const soloDivisions = divisions.filter((d) => d.team_size === 1);
  const teamDivisions = divisions.filter((d) => d.team_size > 1);

  // 類別完全沒上架（migration 未跑／參考表空）→ 不渲染半殘表單
  if (divisions.length === 0) {
    return (
      <div
        role="status"
        className="slab border border-white/15 bg-white/[0.03] px-4 py-6 text-center text-sm text-white/70"
      >
        完賽排行榜尚未開放，請稍後再試。
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {/* 頂部錯誤（欄位級以外的：409／401／400 尚未開放…） */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="slab border border-red-500/40 bg-red-500/10 px-4 py-3"
        >
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-red-300">
            <AlertCircle size={14} /> 提交失敗
          </div>
          <p className="mt-2 text-sm leading-relaxed text-red-200">{error}</p>
          <p className="mt-2 text-xs text-red-200/70">
            請修正後重新提交；若持續失敗請稍後再試。
          </p>
        </div>
      )}

      {/* 成功（凍結文案 §5-5） */}
      {success && (
        <div
          role="status"
          aria-live="polite"
          className="slab border border-emerald-500/40 bg-emerald-500/10 px-4 py-3"
        >
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">
            <CheckCircle2 size={14} /> 已送出
          </div>
          <p className="mt-2 text-sm leading-relaxed text-emerald-200">{success}</p>
          <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-emerald-500/25 pt-2 text-xs text-emerald-200/80">
            <span>目前狀態</span>
            <span className="stat-figure text-xs">待後台確認</span>
          </div>
        </div>
      )}

      {/* 載入：階段式進度（同 RunUploadForm） */}
      {pending && (
        <div
          role="status"
          aria-live="polite"
          className="slab border border-cobalt/40 bg-cobalt/10 px-4 py-3"
        >
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-200">
            <Loader2 size={14} className="animate-spin" />
            {stage === "idle" ? "準備中" : STAGE_TEXT[stage].step}
          </div>
          <div className="mt-2 text-sm text-blue-100">
            {stage === "idle" ? "正在準備檔案…" : STAGE_TEXT[stage].title}
          </div>
          <div className="meter mt-3">
            <div
              className="meter-fill"
              style={{ width: stage === "submit" ? "88%" : "45%" }}
            />
          </div>
          {slow && (
            <p className="mt-2 text-xs text-blue-200/80">
              照片較大或網路較慢時會需要多一點時間，請保持頁面開啟不要關閉。
            </p>
          )}
        </div>
      )}

      {/* ===== 1. 比賽類別：選擇卡 2 欄（§1.6；單人／隊伍分組） ===== */}
      <div id={anchorId("division_code")}>
        <p className="label" id="division-group-label">
          比賽類別
        </p>
        <div
          role="group"
          aria-labelledby="division-group-label"
          className="mt-2 space-y-4"
        >
          {soloDivisions.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/40">
                單人
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {soloDivisions.map((d) => (
                  <DivisionCard
                    key={d.code}
                    division={d}
                    active={division?.code === d.code}
                    invalid={!!fieldErrors.division_code}
                    onClick={() => pickDivision(d)}
                  />
                ))}
              </div>
            </div>
          )}
          {teamDivisions.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/40">
                隊伍
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {teamDivisions.map((d) => (
                  <DivisionCard
                    key={d.code}
                    division={d}
                    active={division?.code === d.code}
                    invalid={!!fieldErrors.division_code}
                    onClick={() => pickDivision(d)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        <FieldError message={fieldErrors.division_code} id="err-division_code" />
      </div>

      {/* ===== 2. 完賽時間：HH：MM：SS 三個獨立數字欄（各自 stepper＋鍵盤） ===== */}
      <div id={anchorId("finish_time")}>
        <p className="label" id="finish-label">
          完賽時間
        </p>
        <div
          role="group"
          aria-labelledby="finish-label"
          className={`mt-2 flex items-stretch gap-2 ${fieldErrors.finish_time ? "rounded-sm ring-1 ring-red-500/40 ring-offset-2 ring-offset-transparent" : ""}`}
        >
          <TimeStepper
            id="finish-hh"
            unitLabel="時"
            value={hh}
            min={0}
            max={23}
            onChange={setHh}
          />
          <span aria-hidden className="self-center text-lg font-bold text-white/40">
            ：
          </span>
          <TimeStepper
            id="finish-mm"
            unitLabel="分"
            value={mm}
            min={0}
            max={59}
            onChange={setMm}
          />
          <span aria-hidden className="self-center text-lg font-bold text-white/40">
            ：
          </span>
          <TimeStepper
            id="finish-ss"
            unitLabel="秒"
            value={ss}
            min={0}
            max={59}
            onChange={setSs}
          />
        </div>
        <FieldError message={fieldErrors.finish_time} id="err-finish_time" />
        <p className="mt-1.5 text-xs text-white/45">
          以 24 小時制填寫，例：1 小時 23 分 45 秒 → 01：23：45。
        </p>
      </div>

      {/* ===== 3. 賽事名稱／比賽日期 ===== */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div id={anchorId("race_name")}>
          <label className="label" htmlFor="race_name">
            賽事名稱
          </label>
          <input
            id="race_name"
            name="race_name"
            type="text"
            value={raceName}
            onChange={(e) => setRaceName(e.target.value)}
            maxLength={80}
            required
            placeholder="例：2026 HYROX 廣州站"
            aria-invalid={!!fieldErrors.race_name}
            aria-describedby={fieldErrors.race_name ? "err-race_name" : undefined}
            className={`field ${fieldErrors.race_name ? "border-red-500/70" : ""}`}
          />
          <FieldError message={fieldErrors.race_name} id="err-race_name" />
        </div>

        <div id={anchorId("race_date")}>
          <label className="label" htmlFor="race_date">
            比賽日期
          </label>
          <input
            id="race_date"
            name="race_date"
            type="date"
            value={raceDate}
            ref={dateInputRef}
            onChange={(e) => setRaceDate(e.target.value)}
            required
            aria-invalid={!!fieldErrors.race_date}
            aria-describedby={fieldErrors.race_date ? "err-race_date" : undefined}
            className={`field ${fieldErrors.race_date ? "border-red-500/70" : ""}`}
          />
          <FieldError message={fieldErrors.race_date} id="err-race_date" />
        </div>
      </div>

      {/* ===== 4. 隊伍欄位：team_size>1 才渲染（§1.6 動態） ===== */}
      {isTeam && (
        <>
          <div id={anchorId("team_name")}>
            <label className="label" htmlFor="team_name">
              隊伍名稱
            </label>
            <input
              id="team_name"
              name="team_name"
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              maxLength={60}
              required
              placeholder="例：MSW A 隊"
              aria-invalid={!!fieldErrors.team_name}
              aria-describedby={fieldErrors.team_name ? "err-team_name" : undefined}
              className={`field ${fieldErrors.team_name ? "border-red-500/70" : ""}`}
            />
            <FieldError message={fieldErrors.team_name} id="err-team_name" />
          </div>

          <div id={anchorId("teammates")}>
            <p className="label" id="teammates-label">
              隊友姓名
            </p>
            <div role="group" aria-labelledby="teammates-label" className="mt-2 space-y-3">
              {teammates.map((name, i) => (
                <div key={`teammate-${i}`}>
                  <label className="sr-only" htmlFor={`teammate-${i}`}>
                    隊友 {i + 1}
                  </label>
                  <input
                    id={`teammate-${i}`}
                    name={`teammate-${i}`}
                    type="text"
                    value={name}
                    onChange={(e) => {
                      const next = [...teammates];
                      next[i] = e.target.value;
                      setTeammates(next);
                    }}
                    maxLength={40}
                    placeholder={`隊友 ${i + 1} 姓名`}
                    aria-invalid={!!fieldErrors.teammates}
                    className={`field ${fieldErrors.teammates ? "border-red-500/70" : ""}`}
                  />
                </div>
              ))}
            </div>
            <FieldError message={fieldErrors.teammates} id="err-teammates" />
            <p className="mt-1.5 text-xs text-white/45">
              {division?.label}為 {teamSize} 人組別，請填 {teamSize - 1} 位隊友姓名。
            </p>
          </div>
        </>
      )}

      {/* ===== 5. 完賽證明截圖（同 /run 的選圖 → 預覽 → 壓縮上傳） ===== */}
      <div id={anchorId("image_path")}>
        <label className="label" htmlFor="result-screenshot">
          完賽證明截圖
        </label>

        <input
          ref={fileRef}
          id="result-screenshot"
          name="result-screenshot"
          type="file"
          accept={RULES.ALLOWED_IMAGE_TYPES.filter((t) => t !== "image/heic").join(",")}
          required
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) {
              setSelectedFile(null);
              setPreview(null);
              setFileName("");
              return;
            }
            setSelectedFile(f);
            setFileName(f.name);
            setPreview(URL.createObjectURL(f));
            setFieldErrors((prev) => ({ ...prev, image_path: undefined }));
          }}
        />

        {preview ? (
          <div className="slab overflow-hidden border border-[var(--line-fine)] bg-black/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="截圖預覽"
              className="max-h-64 w-full object-contain"
            />
            <div className="flex items-center justify-between gap-3 border-t border-[var(--line-fine)] px-3 py-2">
              <span className="min-w-0 truncate text-xs text-white/70">{fileName}</span>
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setSelectedFile(null);
                  setFileName("");
                  if (fileRef.current) fileRef.current.value = "";
                }}
                className="clip-slab inline-flex min-h-11 flex-none items-center gap-1 bg-white/5 px-3 text-xs text-white/80 transition hover:bg-white/10"
                aria-label="移除圖片"
              >
                <X size={14} /> 移除
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-describedby={fieldErrors.image_path ? "err-image_path" : undefined}
            className={`slab flex w-full flex-col items-center gap-2 border border-dashed px-4 py-9 text-center transition hover:border-cobalt-bright hover:bg-black/40 ${
              fieldErrors.image_path
                ? "border-red-500/60 bg-red-500/[0.04]"
                : "border-white/25 bg-black/20"
            }`}
          >
            <ImagePlus size={28} className="text-white/70" />
            <span className="text-sm font-semibold text-white/75">
              點擊上傳完賽證明截圖
            </span>
            <span className="text-xs text-white/60">
              支援 JPG / PNG / WEBP，長邊超過 1600px 會自動壓縮；不支援 iPhone HEIC
            </span>
          </button>
        )}
        <FieldError message={fieldErrors.image_path} id="err-image_path" />
      </div>

      {/* ===== 6. 備註（選填） ===== */}
      <div>
        <label className="label" htmlFor="result-note">
          備註（選填）
        </label>
        <input
          id="result-note"
          name="result-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="例：組別、風速等想補充的資料"
          className="field"
        />
      </div>

      {/* 送出（凍結文案 §5-5：提交按鈕） */}
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
            <UploadCloud size={17} /> 提交完賽成績
          </>
        )}
      </button>

      <p className="border-t border-[var(--line-fine)] pt-4 text-xs leading-relaxed text-white/60">
        提交後狀態為「待確認」，由管理員核對截圖與成績；確認後就會出現在完賽排行榜。
      </p>
    </form>
  );
}

/** 類別選擇卡（2 欄 grid 的一格；點選即高亮，§1.6） */
function DivisionCard({
  division,
  active,
  invalid,
  onClick,
}: {
  division: ResultDivisionOption;
  active: boolean;
  invalid: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`slab min-h-11 w-full border px-3 py-2.5 text-left text-sm transition ${
        active
          ? "border-vital bg-vital/15 font-bold text-white"
          : invalid
            ? "border-red-500/50 bg-white/[0.03] text-white/75 hover:border-white/30"
            : "border-white/15 bg-white/[0.03] text-white/75 hover:border-white/30"
      }`}
    >
      <span className="block break-words leading-snug">{division.label}</span>
      <span
        aria-hidden
        className={`mt-1 block text-[10px] font-semibold uppercase tracking-[0.14em] ${
          active ? "text-vital-bright" : "text-white/40"
        }`}
      >
        {division.team_size === 1 ? "單人" : `${division.team_size} 人組`}
      </span>
    </button>
  );
}

/**
 * HH：MM：SS 的一個數字欄：－ / 數字 / ＋（各自 stepper＋鍵盤，§1.6）。
 * 觸控目標與輸入框都 ≥44px；輸入非數字視為 0，範圍鉗在 min–max。
 */
function TimeStepper({
  id,
  unitLabel,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  unitLabel: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));

  return (
    <div className="flex min-w-0 flex-1 items-stretch gap-1.5">
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        aria-label={`${unitLabel}減 1`}
        className="clip-slab inline-flex min-h-11 min-w-11 flex-none items-center justify-center bg-white/5 text-lg font-bold text-white/80 transition hover:bg-white/10"
      >
        −
      </button>
      <span className="relative min-w-0 flex-1">
        <label className="sr-only" htmlFor={id}>
          {unitLabel}
        </label>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(clamp(parseInt(e.target.value, 10)))}
          className="field h-11 pr-7 text-center tabular-nums"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40"
        >
          {unitLabel}
        </span>
      </span>
      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        aria-label={`${unitLabel}加 1`}
        className="clip-slab inline-flex min-h-11 min-w-11 flex-none items-center justify-center bg-white/5 text-lg font-bold text-white/80 transition hover:bg-white/10"
      >
        ＋
      </button>
    </div>
  );
}

/** 欄位級錯誤（§5-6 凍結訊息；紅字顯示在欄位下方） */
function FieldError({ message, id }: { message?: string; id: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-xs text-red-300">
      {message}
    </p>
  );
}
