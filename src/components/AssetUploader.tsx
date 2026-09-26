"use client";

/**
 * src/components/AssetUploader.tsx — 共用圖片上傳 + 預覽 + 更換 + 移除
 *
 * Owner：方砚。對齊 SPEC-R6.md §3.1（AssetUploader props）。
 *  - event → 16/9、logo → 1/1、hero → 2/1 預覽框
 *  - 上傳中禁用所有操作並顯示 spinner
 *  - disabled 生效
 *  - 移除後 onChange(null)
 * 備註：封面「確認移除」對話框由父層（EventManager）在 onChange(null) 時處理，
 *       本元件只負責把值清成 null。
 */

import { useRef, useState } from "react";
import { ImagePlus, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { uploadImageFile } from "@/lib/upload";
import { publicAssetUrl } from "@/lib/assets";

export interface AssetUploaderProps {
  kind: "event" | "logo" | "hero";
  value: string | null;
  onChange: (path: string | null) => void;
  disabled?: boolean;
  aspect?: "16/9" | "2/1" | "1/1" | "auto";
  hint?: string;
}

export function AssetUploader({
  kind,
  value,
  onChange,
  disabled = false,
  aspect = "auto",
  hint,
}: AssetUploaderProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const preview = value ? publicAssetUrl(value) : null;
  const aspectClass =
    aspect === "16/9"
      ? "aspect-[16/9]"
      : aspect === "1/1"
        ? "aspect-square"
        : aspect === "2/1"
          ? "aspect-[2/1]"
          : "";

  async function handleFile(f: File) {
    setError(null);
    setPending(true);
    try {
      const path = await uploadImageFile(f, kind);
      onChange(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上傳失敗，請稍後再試。");
    } finally {
      setPending(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const isDisabled = disabled || pending;

  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={isDisabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      {preview ? (
        <div className="space-y-3">
          <div
            className={`relative overflow-hidden rounded-xl border border-ink-line bg-black/30 ${aspectClass}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="封面預覽"
              className="h-full w-full object-cover"
            />
            {pending && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/55">
                <Loader2 size={26} className="animate-spin text-white" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isDisabled}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:border-white/40 disabled:opacity-50"
            >
              <RefreshCw size={14} /> 更換
            </button>
            <button
              type="button"
              disabled={isDisabled}
              onClick={() => onChange(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
            >
              <Trash2 size={14} /> 移除
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={isDisabled}
          onClick={() => fileRef.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-white/25 bg-black/20 px-4 py-9 text-center transition hover:border-cobalt-bright hover:bg-black/40 disabled:opacity-50"
        >
          {pending ? (
            <Loader2 size={28} className="animate-spin text-white/60" />
          ) : (
            <ImagePlus size={28} className="text-white/50" />
          )}
          <span className="text-sm font-semibold text-white/75">
            {pending ? "上傳中…" : "點擊上傳圖片"}
          </span>
        </button>
      )}

      {hint && !preview && (
        <p className="text-xs text-white/40">{hint}</p>
      )}
      {error && (
        <p className="text-xs text-red-300">{error}</p>
      )}
    </div>
  );
}
