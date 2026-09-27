"use client";

/**
 * src/app/run/RunUploadForm.tsx — 跑步紀錄上傳（需求 D 根因修復，FE-18）
 *
 * 改造重點（SPEC-R6.md §2.8、§3.2）：
 *  - 選圖後「瀏覽器壓縮 → 直傳 Supabase Storage → 只把 image_path 以 JSON POST /api/runs」
 *  - 檔案位元組不再經過 Vercel（4.5MB 限制徹底失效）
 *  - Storage 上傳失敗顯示 Supabase 的中文錯誤（不是「網路錯誤」）
 *  - 收到非 JSON 回應顯示「伺服器回應異常（HTTP {status}），請稍後再試。」
 *  - HEIC 直接顯示指定提示
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
import { currentMonth, monthLabel, recentMonths } from "@/lib/utils";
import { uploadImageFile } from "@/lib/upload";
import { postJson } from "@/lib/fetch-json";

/** 上傳階段：讓進度有層次，而不是只有一個轉圈 */
type Stage = "idle" | "upload" | "submit";

const STAGE_TEXT: Record<Exclude<Stage, "idle">, { step: string; title: string }> = {
  upload: { step: "Step 01 / 02", title: "壓縮並上傳截圖" },
  submit: { step: "Step 02 / 02", title: "送出紀錄至後台" },
};

export function RunUploadForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // 釋放 preview 的 object URL，避免記憶體洩漏
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  // 超過 3 秒改給文字說明，而不是讓使用者只看轉圈（重設在事件處理器裡做）
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [pending]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const kmRaw = (e.currentTarget.elements.namedItem("km") as HTMLInputElement)?.value;
    const periodMonth = (e.currentTarget.elements.namedItem("period_month") as HTMLSelectElement)?.value;
    const noteRaw = (e.currentTarget.elements.namedItem("note") as HTMLInputElement)?.value;

    if (!selectedFile) {
      setError("請先上傳跑步紀錄截圖。");
      return;
    }

    const km = Number(kmRaw);
    if (!Number.isFinite(km) || km <= 0) {
      setError("請填寫有效的公里數。");
      return;
    }

    setPending(true);
    setSlow(false);
    setStage("upload");
    try {
      // 1) 壓縮 → 直傳 Storage，回傳 image_path（失敗會拋出中文錯誤）
      const imagePath = await uploadImageFile(selectedFile, "run");

      // 2) 只把 path 以 JSON 送 API（不再送整張圖）
      setStage("submit");
      const res = await postJson<{ ok: true; message?: string }>("/api/runs", {
        km,
        period_month: periodMonth,
        image_path: imagePath,
        note: noteRaw?.trim() ? noteRaw.trim() : null,
      });

      setSuccess(res.message ?? "已提交，等待後台確認。");
      formRef.current?.reset();
      setPreview(null);
      setFileName("");
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (err) {
      // Storage 失敗 / 非 JSON 回應 / HEIC：錯誤訊息已由 upload 與 fetch-json 中文化
      setError(err instanceof Error ? err.message : "提交失敗，請稍後再試。");
    } finally {
      setPending(false);
      setSlow(false);
      setStage("idle");
    }
  }

  const months = recentMonths(3);
  const thisMonth = currentMonth();

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-5">
      {/* 錯誤：斜切徽章標頭 + 訊息，層次分明 */}
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

      {/* 成功：斜切徽章標頭 + ledger 狀態列 */}
      {success && (
        <div
          role="status"
          aria-live="polite"
          className="slab border border-emerald-500/40 bg-emerald-500/10 px-4 py-3"
        >
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">
            <CheckCircle2 size={14} /> 已送出
          </div>
          <p className="mt-2 text-sm leading-relaxed text-emerald-200">
            {success}
          </p>
          <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-emerald-500/25 pt-2 text-xs text-emerald-200/80">
            <span>目前狀態</span>
            <span className="stat-figure text-xs">待後台確認</span>
          </div>
        </div>
      )}

      {/* 載入：階段式進度，附文字說明 */}
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

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="km">
            跑步公里數（km）
          </label>
          <input
            id="km"
            name="km"
            type="number"
            step="0.01"
            min="0.01"
            max={RULES.MAX_KM_PER_SUBMISSION}
            required
            placeholder="例如 10.5"
            className="field"
          />
        </div>

        <div>
          <label className="label" htmlFor="period_month">
            計入月份
          </label>
          <select
            id="period_month"
            name="period_month"
            defaultValue={thisMonth}
            className="field"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="screenshot">
          跑步紀錄截圖
        </label>

        <input
          ref={fileRef}
          id="screenshot"
          name="screenshot"
          type="file"
          accept={RULES.ALLOWED_IMAGE_TYPES.join(",")}
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
              <span className="min-w-0 truncate text-xs text-white/70">
                {fileName}
              </span>
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
            className="slab flex w-full flex-col items-center gap-2 border border-dashed border-white/25 bg-black/20 px-4 py-9 text-center transition hover:border-cobalt-bright hover:bg-black/40"
          >
            <ImagePlus size={28} className="text-white/70" />
            <span className="text-sm font-semibold text-white/75">
              點擊上傳跑步 app 截圖
            </span>
            <span className="text-xs text-white/60">
              支援 JPG / PNG / WEBP，長邊超過 1600px 會自動壓縮；不支援 iPhone HEIC
            </span>
          </button>
        )}
      </div>

      <div>
        <label className="label" htmlFor="note">
          備註（選填）
        </label>
        <input
          id="note"
          name="note"
          type="text"
          placeholder="例如：黑沙環海濱長廊晨跑"
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
            <Loader2 size={17} className="animate-spin" /> 上傳中…
          </>
        ) : (
          <>
            <UploadCloud size={17} /> 提交紀錄
          </>
        )}
      </button>

      <p className="border-t border-[var(--line-fine)] pt-4 text-xs leading-relaxed text-white/60">
        提交後狀態為「待確認」，由管理員核對截圖與里程。確認後才會計入當月累積里程，
        每公里可獲得 {RULES.POINTS_PER_KM} 積分。
      </p>
    </form>
  );
}
