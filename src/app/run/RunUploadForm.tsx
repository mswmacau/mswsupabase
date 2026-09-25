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
import { AlertCircle, CheckCircle2, ImagePlus, Loader2, UploadCloud, X } from "lucide-react";
import { RULES } from "@/lib/config";
import { currentMonth, monthLabel, recentMonths } from "@/lib/utils";
import { uploadImageFile } from "@/lib/upload";
import { postJson } from "@/lib/fetch-json";

export function RunUploadForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
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
    try {
      // 1) 壓縮 → 直傳 Storage，回傳 image_path（失敗會拋出中文錯誤）
      const imagePath = await uploadImageFile(selectedFile, "run");

      // 2) 只把 path 以 JSON 送 API（不再送整張圖）
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
    }
  }

  const months = recentMonths(3);
  const thisMonth = currentMonth();

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-5">
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
          <span>{success}</span>
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
          <div className="relative overflow-hidden rounded-xl border border-ink-line bg-black/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="截圖預覽"
              className="max-h-64 w-full object-contain"
            />
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setSelectedFile(null);
                setFileName("");
                if (fileRef.current) fileRef.current.value = "";
              }}
              className="absolute right-2 top-2 rounded-lg bg-black/70 p-1.5 text-white/80 transition hover:bg-black"
              aria-label="移除圖片"
            >
              <X size={16} />
            </button>
            <div className="border-t border-ink-line px-3 py-2 text-xs text-white/50">
              {fileName}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-white/25 bg-black/20 px-4 py-9 text-center transition hover:border-cobalt-bright hover:bg-black/40"
          >
            <ImagePlus size={28} className="text-white/50" />
            <span className="text-sm font-semibold text-white/75">
              點擊上傳跑步 app 截圖
            </span>
            <span className="text-xs text-white/40">
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

      <button type="submit" disabled={pending} className="btn-base btn-vital w-full">
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

      <p className="text-xs leading-relaxed text-white/40">
        提交後狀態為「待確認」，由管理員核對截圖與里程。確認後才會計入當月累積里程，
        每公里可獲得 {RULES.POINTS_PER_KM} 積分。
      </p>
    </form>
  );
}
