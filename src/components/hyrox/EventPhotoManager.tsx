"use client";

/**
 * src/components/hyrox/EventPhotoManager.tsx — 後台「回顧相片」管理（client）
 *
 * 端點（與後端契約對齊）：
 *   GET  /api/admin/hyrox/photos?event_id=<uuid>
 *        → { ok:true, photos:[{id,path,url,caption,sort_order}] }
 *   POST /api/admin/hyrox/photos
 *        { action:'add', event_id, path } | { action:'remove', id }
 *        | { action:'update', id, caption }
 *
 * 上傳流程（多張）：逐張 uploadImageFile(file,'event') → POST add。
 *   一張失敗不影響其他張，最後統一回報「成功 N 張、失敗 M 張」，
 *   不會把失敗當成成功。
 *
 * 邊界：載入中（3 秒後補文字）、空清單（文案）、失敗（可重試）、上傳中禁用操作。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ImagePlus,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { getHyrox, postHyrox } from "./api";
import { publicAssetUrl } from "@/lib/assets";
import { uploadImageFile } from "@/lib/upload";

interface AdminPhoto {
  id: string;
  path: string;
  url?: string | null;
  caption: string | null;
  sort_order: number;
}

const MAX_FILES = 12;

export function EventPhotoManager({
  eventId,
  disabled = false,
}: {
  eventId: string;
  disabled?: boolean;
}) {
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [uploading, setUploading] = useState<{ total: number; done: number } | null>(
    null
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [captions, setCaptions] = useState<Record<string, string>>({});

  const fileRef = useRef<HTMLInputElement>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setSlow(false);
    setError(null);
    const res = await getHyrox<{ photos?: AdminPhoto[] }>(
      `/api/admin/hyrox/photos?event_id=${encodeURIComponent(eventId)}`
    );
    if (!aliveRef.current) return;
    if (res.ok) {
      const list = res.photos ?? [];
      setPhotos(list);
      setCaptions(
        Object.fromEntries(list.map((p) => [p.id, p.caption ?? ""]))
      );
    } else {
      setPhotos([]);
      setError(res.error);
    }
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    async function run() {
      await load();
    }
    void run();
  }, [load]);

  // 超過 3 秒給文字說明，而不是只有轉圈
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(timer);
  }, [loading]);

  async function handleFiles(fileList: FileList) {
    const files = Array.from(fileList).slice(0, MAX_FILES);
    if (files.length === 0) return;

    setError(null);
    setNotice(null);
    setUploading({ total: files.length, done: 0 });

    const added: AdminPhoto[] = [];
    const failed: string[] = [];

    for (const [i, file] of files.entries()) {
      try {
        const path = await uploadImageFile(file, "event");
        const res = await postHyrox<{ photo?: AdminPhoto }>(
          "/api/admin/hyrox/photos",
          { action: "add", event_id: eventId, path }
        );
        if (res.ok) {
          if (res.photo) {
            added.push(res.photo);
          } else {
            // 後端沒回新建的那筆：留一個佔位，最後統一重抓清單補齊
            added.push({
              id: `pending-${path}`,
              path,
              caption: null,
              sort_order: 0,
            });
          }
        } else {
          failed.push(`${file.name}：${res.error}`);
        }
      } catch (e) {
        failed.push(`${file.name}：${e instanceof Error ? e.message : "上傳失敗"}`);
      }
      if (aliveRef.current) {
        setUploading({ total: files.length, done: i + 1 });
      }
    }

    if (fileRef.current) fileRef.current.value = "";
    if (!aliveRef.current) return;

    setUploading(null);
    if (added.length > 0) {
      setNotice(
        `已加入 ${added.length} 張回顧相片${failed.length > 0 ? `，${failed.length} 張失敗` : ""}。`
      );
      await load(); // 以伺服器清單為準（也有 id／排序）
    }
    if (failed.length > 0) {
      setError(`有 ${failed.length} 張未成功：${failed.join("；")}`);
    }
  }

  async function remove(photo: AdminPhoto) {
    setBusyId(photo.id);
    setError(null);
    setNotice(null);
    const res = await postHyrox<Record<string, never>>(
      "/api/admin/hyrox/photos",
      { action: "remove", id: photo.id }
    );
    setBusyId(null);
    if (!aliveRef.current) return;
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    setNotice("已移除這張相片。");
  }

  async function saveCaption(photo: AdminPhoto) {
    setBusyId(photo.id);
    setError(null);
    setNotice(null);
    const res = await postHyrox<Record<string, never>>(
      "/api/admin/hyrox/photos",
      { action: "update", id: photo.id, caption: captions[photo.id] ?? "" }
    );
    setBusyId(null);
    if (!aliveRef.current) return;
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const next = captions[photo.id] ?? "";
    setPhotos((prev) =>
      prev.map((p) =>
        p.id === photo.id ? { ...p, caption: next.trim() === "" ? null : next } : p
      )
    );
    setNotice("說明已儲存。");
  }

  const busy = disabled || uploading !== null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white/85">回顧相片</p>
          <p className="mt-1 text-xs leading-relaxed text-white/55">
            可一次揀多張，逐張上傳。相片會出現在「往期場次」詳情頁的相片回顧區。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || busy}
          className="btn-base btn-ghost min-h-11 px-3 py-2 text-xs disabled:opacity-60"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          重新整理
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) void handleFiles(files);
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-white/25 bg-black/20 px-4 py-6 text-center transition hover:border-cobalt-bright hover:bg-black/40 disabled:opacity-50"
      >
        {uploading ? (
          <>
            <Loader2 size={24} className="animate-spin text-white/75" />
            <span className="text-sm font-semibold text-white/75">
              上傳中… {uploading.done} / {uploading.total}
            </span>
          </>
        ) : (
          <>
            <ImagePlus size={24} className="text-white/70" />
            <span className="text-sm font-semibold text-white/75">
              點擊選擇相片（可多選）
            </span>
            <span className="text-[11px] text-white/45">
              一次最多 {MAX_FILES} 張；iPhone 相片請先轉 JPG。
            </span>
          </>
        )}
      </button>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-red-200"
        >
          <span className="break-words">{error}</span>
        </div>
      )}
      {notice && (
        <p
          role="status"
          aria-live="polite"
          className="flex items-center gap-1.5 text-xs text-emerald-300"
        >
          <CheckCircle2 size={14} className="flex-none" />
          <span className="min-w-0 break-words">{notice}</span>
        </p>
      )}

      {loading && photos.length === 0 && (
        <div role="status" className="px-1 py-4 text-center">
          <Loader2 size={18} className="mx-auto animate-spin text-white/50" />
          <p className="mt-2 text-xs text-white/55">正在讀取相片…</p>
          {slow && (
            <p className="mt-1 text-[11px] text-white/45">
              比平常慢，可以按「重新整理」再試。
            </p>
          )}
        </div>
      )}

      {!loading && photos.length === 0 && !error && (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-4 text-center text-xs text-white/55">
          還沒有回顧相片。活動結束後把當日相片傳上來，會員就可以在往期場次回顧。
        </p>
      )}

      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {photos.map((photo) => {
            const url = photo.url ?? publicAssetUrl(photo.path);
            const rowBusy = busyId === photo.id;
            const caption = captions[photo.id] ?? "";
            const dirty = caption !== (photo.caption ?? "");
            return (
              <li
                key={photo.id}
                className="min-w-0 overflow-hidden rounded-xl border border-ink-line bg-black/25"
              >
                <div className="aspect-[4/3] w-full overflow-hidden bg-black/40">
                  {url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={url}
                      alt={photo.caption ?? "回顧相片"}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center text-[11px] text-white/40">
                      預覽不可用
                    </span>
                  )}
                </div>

                <div className="space-y-2 p-2.5">
                  <label className="block">
                    <span className="sr-only">相片說明</span>
                    <input
                      value={caption}
                      maxLength={120}
                      disabled={busy}
                      onChange={(e) =>
                        setCaptions((prev) => ({
                          ...prev,
                          [photo.id]: e.target.value,
                        }))
                      }
                      placeholder="說明（例如 起跑前熱身）"
                      className="field px-2.5 py-1.5 text-xs"
                    />
                  </label>

                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={busy || rowBusy || !dirty}
                      onClick={() => void saveCaption(photo)}
                      className="btn-base btn-ghost min-h-11 flex-1 px-2 py-1.5 text-[11px] disabled:opacity-45"
                    >
                      {rowBusy ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        "儲存說明"
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={busy || rowBusy}
                      onClick={() => void remove(photo)}
                      aria-label="移除這張相片"
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-red-500/45 text-red-300 transition hover:bg-red-500/15 disabled:opacity-45"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
