/**
 * src/lib/image-compress.ts — 瀏覽器端 canvas 壓縮（需求 D 根因修復的一部分）
 *
 * Owner：方砚。只在瀏覽器（client component）呼叫，會使用 document / canvas。
 *
 * 契約：SPEC-R6.md §3.2
 *  - 長邊 ≤ 1600、初始品質 0.82
 *  - 結果 > 1.2MB（MAX_UPLOAD_BYTES）時降品質重試（最多 3 次），仍過大則長邊改 1280 再壓
 *  - HEIC / HEIF 直接拋出可顯示的中文錯誤
 *  - 原檔 > MAX_UPLOAD_SOURCE_MB 直接擋（不壓縮、不上傳）
 *  - 回傳 Blob 的 mime 與副檔名（由呼叫端推算）一致
 */

import { RULES } from "./config";

/** 可被前端直接顯示錯誤訊息的錯誤類別 */
export class ImgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImgError";
  }
}

const HEIC_RE = /\.(heic|heif)$/i;

export interface CompressOptions {
  /** 長邊上限，預設 1600 */
  maxEdge?: number;
  /** 初始壓縮品質，預設 0.82 */
  quality?: number;
  /** 壓縮後體積上限（bytes），預設 MAX_UPLOAD_BYTES */
  maxBytes?: number;
  /** 原檔上限（MB），超過直接擋，預設 MAX_UPLOAD_SOURCE_MB */
  maxSourceMB?: number;
}

type Drawable = ImageBitmap | HTMLImageElement;

function isHeic(file: File): boolean {
  const t = file.type.toLowerCase();
  return t === "image/heic" || t === "image/heif" || HEIC_RE.test(file.name);
}

async function loadViaImg(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new ImgError("無法讀取這張圖片，請換一張再試。"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadBitmap(file: File): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, {
        imageOrientation: "from-image",
      } as ImageBitmapOptions);
    } catch {
      // 某些瀏覽器不支援 from-image，退回不帶參數
      try {
        return await createImageBitmap(file);
      } catch {
        // 再退回 <img>
      }
    }
  }
  return await loadViaImg(file);
}

/**
 * 繪製來源封裝：管理 ImageBitmap / HTMLImageElement 的生命週期，
 * 並對 createImageBitmap 回傳「已 detached」ImageBitmap 的環境（headless chromium、
 * 部分瀏覽器的 PNG）做健壯處理——drawImage 拋 /detach/i 錯誤時，改用 <img> 重新載入。
 *
 * 為何要封裝：原 drawToBlob 在每次繪製後就 source.close()（ImageBitmap 一 close 即
 * detached），降品質重試會複用同一個已 detached 的 bitmap 再拋錯。這裡改為只在最後
 * dispose() 關閉一次，且回退為 <img> 後續繪製都複用同一個 <img>（不再重載）。
 */
class DrawSource {
  private current: Drawable;
  private readonly file: File;
  private disposed = false;

  constructor(file: File, initial: Drawable) {
    this.file = file;
    this.current = initial;
  }

  get width(): number {
    return this.current.width;
  }

  get height(): number {
    return this.current.height;
  }

  async toBlob(
    width: number,
    height: number,
    mime: string,
    quality?: number
  ): Promise<Blob> {
    if (this.disposed) {
      throw new ImgError("圖片處理已結束，請重新上傳。");
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImgError("瀏覽器不支援圖片壓縮，請改用其他瀏覽器。");

    try {
      ctx.drawImage(this.current, 0, 0, width, height);
    } catch (err) {
      // 部分環境（PNG + createImageBitmap）回傳的 ImageBitmap 在繪製時已 detached，
      // 改用 HTMLImageElement 重新載入繪製（<img> 的 drawImage 最穩，PNG 無 EXIF 方向問題）。
      if (err instanceof Error && /detach/i.test(err.message)) {
        const img = await loadViaImg(this.file);
        this.disposeCurrent(); // 關閉舊 bitmap（若有）
        this.current = img;
        ctx.drawImage(this.current, 0, 0, width, height);
      } else {
        throw err;
      }
    }

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(new ImgError("圖片壓縮失敗，請重新上傳。")),
        mime,
        quality
      );
    });
  }

  private disposeCurrent(): void {
    // 僅 ImageBitmap 有 close；HTMLImageElement 無 close，object URL 已在 loadViaImg 釋放。
    if ("close" in this.current && typeof this.current.close === "function") {
      (this.current as ImageBitmap).close();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposeCurrent();
    this.disposed = true;
  }
}

/**
 * 壓縮圖片。回傳的 Blob 其 type 與副檔名對應（呼叫端用 extFromMime 推算副檔名）。
 */
export async function compressImage(
  file: File,
  opts: CompressOptions = {}
): Promise<Blob> {
  const maxEdge = opts.maxEdge ?? 1600;
  const startQuality = opts.quality ?? 0.82;
  const maxBytes = opts.maxBytes ?? RULES.MAX_UPLOAD_BYTES;
  const maxSourceMB = opts.maxSourceMB ?? RULES.MAX_UPLOAD_SOURCE_MB;

  // HEIC 明確報錯（SPEC §3.2）
  if (isHeic(file)) {
    throw new ImgError(
      "iPhone 的 HEIC 照片無法直接使用，請在「設定 → 相機 → 格式」改為「相容性最佳」，或先轉成 JPG 再上傳。"
    );
  }

  // 原檔上限
  if (file.size > maxSourceMB * 1024 * 1024) {
    throw new ImgError("圖片過大，請改用較小或較短邊的照片。");
  }

  const source = new DrawSource(file, await loadBitmap(file));
  try {
    const longEdge = Math.max(source.width, source.height);
    if (!longEdge || Number.isNaN(longEdge)) {
      throw new ImgError("無法讀取圖片尺寸，請換一張再試。");
    }

    // PNG 保留透明度；其餘（含 JPEG）輸出 JPEG 以利壓縮
    const inputType = file.type || "image/jpeg";
    const keepPng = inputType === "image/png";
    const mime = keepPng ? "image/png" : "image/jpeg";

    const baseScale = Math.min(1, maxEdge / longEdge);
    const w = Math.max(1, Math.round(source.width * baseScale));
    const h = Math.max(1, Math.round(source.height * baseScale));

    if (keepPng) {
      // PNG 不接受 quality 參數；logo 通常極小，resize 已足夠
      const blob = await source.toBlob(w, h, "image/png");
      if (blob.size > maxBytes) {
        // 仍過大 → 退為 JPEG
        return await source.toBlob(w, h, "image/jpeg", startQuality);
      }
      return blob;
    }

    let quality = startQuality;
    let blob = await source.toBlob(w, h, mime, quality);

    // 降品質重試（最多 3 次）
    let attempt = 0;
    while (blob.size > maxBytes && attempt < 3) {
      quality = Math.max(0.4, quality - 0.12);
      blob = await source.toBlob(w, h, "image/jpeg", quality);
      attempt++;
    }

    // 仍過大 → 長邊改 1280 再壓一次
    if (blob.size > maxBytes) {
      const scale2 = Math.min(1, 1280 / longEdge);
      const w2 = Math.max(1, Math.round(source.width * scale2));
      const h2 = Math.max(1, Math.round(source.height * scale2));
      blob = await source.toBlob(w2, h2, "image/jpeg", quality);
    }

    return blob;
  } finally {
    source.dispose();
  }
}

/** 由 Blob.mime 推算檔案副檔名（與 mime 一致，滿足 FE-1 ④） */
export function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  return "jpg"; // image/jpeg 等一律 jpg（符合 cover_path 正則）
}
