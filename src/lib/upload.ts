/**
 * src/lib/upload.ts — 瀏覽器直傳 Supabase Storage（需求 D 根因修復的核心）
 *
 * Owner：方砚。流程：壓縮 → 直傳 → 回傳 path；檔案位元組完全不經過 Vercel（H2）。
 * 統一 Storage 錯誤中文化（SPEC §3.2 錯誤映射表）。
 *
 * 重要：本檔只能在瀏覽器端（client component）呼叫。
 */

import { createClient } from "./supabase/client";
import { compressImage, extFromMime, ImgError } from "./image-compress";
import type { AssetKind } from "./assets";

const BUCKET: Record<AssetKind, string> = {
  event: "site-assets",
  logo: "site-assets",
  hero: "site-assets",
  run: "run-screenshots",
};

/** 由 Storage 錯誤映射到給終端客戶看的中文訊息（SPEC §3.2） */
function mapStorageError(err: {
  message?: string;
  statusCode?: number | string;
}): ImgError {
  const code = Number(err.statusCode);
  const msg = (err.message ?? "").toLowerCase();
  if (
    code === 400 ||
    code === 403 ||
    /row violates row-level security/i.test(msg) ||
    /permission/i.test(msg)
  ) {
    return new ImgError("沒有上傳權限，請重新登入後再試。");
  }
  if (code === 401) return new ImgError("登入逾期，請重新登入。");
  if (code === 413) return new ImgError("圖片過大，請改用較小或較短邊的照片。");
  return new ImgError(`圖片上傳失敗：${err.message ?? "請稍後再試。"}`);
}

function yyyymm(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 產生不覆寫的同名物件路徑（含 Date.now() + 6 位亂數，SPEC §1.4 硬規則） */
function buildPath(kind: AssetKind, ext: string, uid?: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const base = `${ts}-${rand}.${ext}`;
  switch (kind) {
    case "event":
      return `events/${yyyymm()}/${base}`;
    case "logo":
      return `logo/${base}`;
    case "hero":
      return `hero/${base}`;
    case "run":
      return `${uid}/${base}`;
  }
}

/**
 * 壓縮後直傳 Storage，回傳內部 path（不是完整網址）。
 * path 會送給 Route Handler，再由後端做存在性檢查後寫 DB。
 */
export async function uploadImageFile(
  file: File,
  kind: AssetKind
): Promise<string> {
  const supabase = createClient();
  if (!supabase) {
    throw new ImgError("尚未連接 Supabase，請稍後再試。");
  }

  const blob = await compressImage(file);

  let uid: string | undefined;
  if (kind === "run") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new ImgError("登入逾期，請重新登入。");
    uid = user.id;
  }

  const ext = extFromMime(blob.type || "image/jpeg");
  const path = buildPath(kind, ext, uid);

  try {
    const { error } = await supabase.storage
      .from(BUCKET[kind])
      .upload(path, blob, {
        upsert: false,
        cacheControl: "31536000",
        contentType: blob.type || "image/jpeg",
      });

    if (error) throw mapStorageError(error);
  } catch (err) {
    if (err instanceof ImgError) throw err;
    // 網路層錯誤（TypeError: Failed to fetch 等）
    if (err instanceof TypeError) {
      throw new ImgError("網路中斷，請檢查連線後重新上傳。");
    }
    throw new ImgError("圖片上傳失敗，請稍後再試。");
  }

  return path;
}
