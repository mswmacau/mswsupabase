"use client";

/**
 * src/components/hyrox/ProofUploader.tsx — 轉帳證明上傳（選檔即上傳）
 *
 * 模式對齊 src/app/run/RunUploadForm.tsx：
 *   選檔 → 本地預覽（URL.createObjectURL）→ 立即壓縮直傳 Storage → 拿到 path
 *   才把 path 交給父層（父層拿 path 才准提交）。
 *
 * 邊界處理：
 *   - 大小：>10 MB 直接擋（不浪費一次上傳）
 *   - 上傳中：禁用操作 + spinner
 *   - 上傳失敗：可讀中文訊息 + 可直接重選（同一個按鈕）
 *   - 記憶體：object URL 在換檔／移除／卸載時 revoke
 *   - 手機：min-h-11 觸控目標，預覽圖 max-h-64 不撐破 390
 */

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ImagePlus, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { uploadImageFile } from "@/lib/upload";
import { publicAssetUrl } from "@/lib/assets";
import { RULES } from "@/lib/config";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB（契約：可上載 1 個檔案，大小上限 10 MB）

export function ProofUploader({
  value,
  onChange,
  disabled = false,
}: {
  /** Storage path（不是完整網址）；null = 未上傳 */
  value: string | null;
  onChange: (path: string | null) => void;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  // 釋放 object URL，避免記憶體持續增長
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  /** 已上傳但沒有本地預覽（例如重新進入頁面看舊截圖）→ 用公開網址顯示 */
  const remotePreview = !preview && value ? publicAssetUrl(value) : null;
  const shown = preview ?? remotePreview;

  function reset() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFileName("");
    onChange(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleFile(f: File) {
    setError(null);

    if (f.size > MAX_BYTES) {
      setError(
        `檔案 ${(f.size / 1024 / 1024).toFixed(1)} MB 超過 10 MB 上限，請先壓縮或重新截圖。`
      );
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
    setFileName(f.name);
    setPending(true);
    try {
      const path = await uploadImageFile(f, "payment");
      onChange(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上傳失敗，請稍後再試。");
      onChange(null);
    } finally {
      setPending(false);
    }
  }

  const isDisabled = disabled || pending;

  return (
    <div className="min-w-0 space-y-2">
      <input
        ref={fileRef}
        id="hyrox-proof"
        type="file"
        accept={RULES.ALLOWED_IMAGE_TYPES.filter((t) => t !== "image/heic").join(",")}
        className="hidden"
        disabled={isDisabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      {!shown ? (
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => fileRef.current?.click()}
          className="slab flex min-h-11 w-full flex-col items-center gap-2 border border-dashed border-white/25 bg-black/20 px-4 py-9 text-center transition hover:border-cobalt-bright hover:bg-black/40 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 size={28} className="animate-spin text-white/75" />
          ) : (
            <ImagePlus size={28} className="text-white/70" />
          )}
          <span className="text-sm font-semibold text-white/80">
            {pending ? "上傳中…" : "點擊選擇轉帳截圖"}
          </span>
          <span className="max-w-full break-words text-xs text-white/55">
            支援 JPG / PNG / WEBP，上限 10 MB；截圖太大會自動壓縮
          </span>
        </button>
      ) : (
        <div className="slab overflow-hidden border border-[var(--line-fine)] bg-black/30">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shown}
              alt="轉帳證明預覽"
              className="max-h-64 w-full object-contain"
            />
            {pending && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <Loader2 size={26} className="animate-spin text-white" />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line-fine)] px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              {pending ? (
                <span className="flex flex-none items-center gap-1.5 text-xs text-white/60">
                  <Loader2 size={13} className="animate-spin" /> 上傳中
                </span>
              ) : value ? (
                <span className="flex flex-none items-center gap-1.5 text-xs font-semibold text-emerald-300">
                  <CheckCircle2 size={13} /> 已上傳
                </span>
              ) : (
                <span className="flex flex-none items-center gap-1.5 text-xs text-red-300">
                  <X size={13} /> 未完成
                </span>
              )}
              <span className="min-w-0 truncate text-xs text-white/55">
                {fileName || "轉帳證明"}
              </span>
            </div>

            <div className="flex flex-none gap-2">
              <button
                type="button"
                disabled={isDisabled}
                onClick={() => fileRef.current?.click()}
                className="clip-slab inline-flex min-h-11 items-center gap-1 bg-white/5 px-3 text-xs text-white/80 transition hover:bg-white/10 disabled:opacity-50"
              >
                <RefreshCw size={13} /> 重選
              </button>
              <button
                type="button"
                disabled={isDisabled}
                onClick={reset}
                className="clip-slab inline-flex min-h-11 items-center gap-1 bg-white/5 px-3 text-xs text-white/80 transition hover:bg-white/10 disabled:opacity-50"
                aria-label="移除轉帳證明"
              >
                <Trash2 size={13} /> 移除
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" aria-live="polite" className="break-words text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
