"use client";

/**
 * src/app/admin/slides/SlidesManager.tsx — 首頁輪播的後台管理（client）
 *
 * 端點（與 src/app/api/admin/slides/route.ts 的契約對齊）：
 *   GET  /api/admin/slides → { ok:true, slides:HomeSlide[] }
 *   POST { action:'create', path, alt } | { action:'update', id, alt?, link_url?, is_active? }
 *        | { action:'remove', id } | { action:'reorder', ids }
 *
 * 上傳流程（多張）：逐張 uploadSlideImage(file) → POST create。
 *   一張失敗不影響其他張，最後統一回報「成功 N 張、失敗 M 張」，不會把失敗當成成功。
 *
 * 【為什麼不用 @/lib/upload 的 uploadImageFile】
 * 那個函式的 UploadKind 只有 event / logo / hero / coach / reward / run / payment
 * （src/lib/upload.ts:22-33），沒有 "home"，buildPath（同檔 61-83）也不會產生
 * home/ 前綴；但 migration-home-slides.sql 的 home_slides_path_fmt 約束要求
 * path 必須以 home/ 開頭。本次交付範圍不含 upload.ts，所以在本檔自建一個
 * 只做「壓縮 → 直傳 site-assets 的 home/ 前綴」的小函式，
 * 壓縮（compressImage）與錯誤文案沿用同一套。
 * 待辦：若日後允許改 upload.ts，應把 "home" 併回 UploadKind 並刪掉這裡的重複。
 *
 * 邊界（三項都必須有）：載入中（3 秒後補文字）、空清單（文案）、失敗（可重讀／重試）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { publicAssetUrl } from "@/lib/assets";
import { createClient } from "@/lib/supabase/client";
import { compressImage, extFromMime, ImgError } from "@/lib/image-compress";
import { FetchError, requestJson } from "@/lib/fetch-json";
import type { HomeSlide } from "@/lib/home-slides";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ImagePlus,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";

/** 硬上限，與 migration-home-slides.sql 的 trigger 一致（不要在 client import 伺服器模組的常數） */
const MAX_SLIDES = 30;
/** 一次最多選幾張，避免一次拉太久 */
const MAX_FILES_PER_BATCH = 20;
const SLIDE_BUCKET = "site-assets";

/* =============================================================
 * 上傳：壓縮 → 直傳 site-assets/home/
 * ============================================================= */
async function uploadSlideImage(file: File): Promise<string> {
  const supabase = createClient();
  if (!supabase) throw new ImgError("尚未連接 Supabase，請稍後再試。");

  const blob = await compressImage(file);
  const ext = extFromMime(blob.type || "image/jpeg");
  const path = `home/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage
    .from(SLIDE_BUCKET)
    .upload(path, blob, {
      upsert: false,
      cacheControl: "31536000",
      contentType: blob.type || "image/jpeg",
    });

  if (error) {
    const msg = (error.message ?? "").toLowerCase();
    if (/row-level security|permission|not authorized/i.test(msg)) {
      throw new ImgError("沒有上傳權限，請重新登入後再試。");
    }
    throw new ImgError("圖片上傳失敗，請稍後再試。");
  }

  return path;
}

/** 把檔名去掉副檔名，當作 alt 的預設值（使用者一定要能改） */
function altFromFile(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, "").trim();
  // alt 上限 120 字（DB 約束），這裡先截短避免第一次 create 就被擋
  return base.slice(0, 120) || "首頁形象圖";
}

/** 錯誤 → 可直接顯示的中文句子（有欄位級錯誤就取第一個） */
function errorMessage(err: unknown): string {
  if (err instanceof FetchError) {
    const firstField = err.fields ? Object.values(err.fields)[0] : undefined;
    return firstField ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return "操作失敗，請稍後再試。";
}

/* =============================================================
 * 元件
 * ============================================================= */
export function SlidesManager({ initialSlides }: { initialSlides: HomeSlide[] }) {
  const [slides, setSlides] = useState<HomeSlide[]>(initialSlides);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [uploading, setUploading] = useState<{ total: number; done: number } | null>(
    null
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  // 每列的 alt / link_url 草稿（以 id 為 key）
  const [drafts, setDrafts] = useState<
    Record<string, { alt: string; link_url: string }>
  >(() =>
    Object.fromEntries(
      initialSlides.map((s) => [
        s.id,
        { alt: s.alt, link_url: s.link_url ?? "" },
      ])
    )
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /** 以伺服器清單為準（同時帶回 sort_order 與 created_at 的真相） */
  const applyList = useCallback((list: HomeSlide[]) => {
    setSlides(list);
    setDrafts(
      Object.fromEntries(
        list.map((s) => [s.id, { alt: s.alt, link_url: s.link_url ?? "" }])
      )
    );
  }, []);

  /** 手動／操作後重讀（會顯示 loading） */
  const load = useCallback(async () => {
    setLoading(true);
    setSlow(false);
    setError(null);
    try {
      const data = await requestJson<{ slides?: HomeSlide[] }>(
        "/api/admin/slides",
        { method: "GET" }
      );
      if (!aliveRef.current) return;
      applyList(data.slides ?? []);
    } catch (err) {
      if (!aliveRef.current) return;
      // 這裡最常見的原因是 migration 還沒跑（API 回 SCHEMA_OUTDATED），
      // 所以一定要把後端訊息原樣顯示，不能靜默成空清單。
      setError(errorMessage(err));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [applyList]);

  // 掛載後對帳一次：表面上是多打一次 API，實際上是把「表還沒建」這類
  // 伺服器端才知道的問題顯示給管理員（initialSlides 只會是空陣列）。
  // 注意：所有 setState 都放在 promise 回呼裡，effect body 本身不碰 state。
  useEffect(() => {
    requestJson<{ slides?: HomeSlide[] }>("/api/admin/slides", { method: "GET" })
      .then((data) => {
        if (aliveRef.current) applyList(data.slides ?? []);
      })
      .catch((err: unknown) => {
        if (aliveRef.current) setError(errorMessage(err));
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false);
      });
  }, [applyList]);

  // 超過 3 秒給文字說明，而不是只有轉圈
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(timer);
  }, [loading]);

  /* ---------------- 多選上傳 ---------------- */
  async function handleFiles(fileList: FileList) {
    const room = MAX_SLIDES - slides.length;
    if (room <= 0) {
      setError(`已經有 ${MAX_SLIDES} 張，請先刪除不需要的圖片再加新的。`);
      return;
    }

    const picked = Array.from(fileList);
    const files = picked.slice(0, Math.min(MAX_FILES_PER_BATCH, room));

    if (picked.length > files.length) {
      setNotice(
        `這次只處理 ${files.length} 張${
          picked.length > MAX_FILES_PER_BATCH
            ? `（一次最多 ${MAX_FILES_PER_BATCH} 張）`
            : `（上限 ${MAX_SLIDES} 張）`
        }，其餘請再選一次。`
      );
    }

    setError(null);
    setUploading({ total: files.length, done: 0 });

    const failed: string[] = [];
    let added = 0;

    for (const [i, file] of files.entries()) {
      try {
        const path = await uploadSlideImage(file);
        await requestJson<{ slide?: HomeSlide }>("/api/admin/slides", {
          method: "POST",
          body: { action: "create", path, alt: altFromFile(file) },
        });
        added += 1;
      } catch (err) {
        failed.push(`${file.name}：${errorMessage(err)}`);
      }
      if (aliveRef.current) setUploading({ total: files.length, done: i + 1 });
    }

    if (fileRef.current) fileRef.current.value = "";
    if (!aliveRef.current) return;

    setUploading(null);
    if (added > 0) {
      setNotice(
        `已上傳 ${added} 張輪播圖${failed.length > 0 ? `，${failed.length} 張失敗` : ""}。請補齊替代文字。`
      );
      await load();
    }
    if (failed.length > 0) {
      setError(`有 ${failed.length} 張未成功：${failed.join("；")}`);
    }
  }

  /* ---------------- 逐列操作 ---------------- */
  async function patchSlide(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const data = await requestJson<{ slide?: HomeSlide; message?: string }>(
        "/api/admin/slides",
        { method: "POST", body: { action: "update", id, ...body } }
      );
      if (!aliveRef.current) return;
      const slide = data.slide;
      if (slide) {
        setSlides((prev) => prev.map((s) => (s.id === id ? slide : s)));
        setDrafts((prev) => ({
          ...prev,
          [id]: { alt: slide.alt, link_url: slide.link_url ?? "" },
        }));
      }
      setNotice(data.message ?? "已更新。");
    } catch (err) {
      if (aliveRef.current) setError(errorMessage(err));
    } finally {
      if (aliveRef.current) setBusyId(null);
    }
  }

  async function toggleActive(slide: HomeSlide) {
    await patchSlide(slide.id, { is_active: !slide.is_active });
  }

  async function saveDraft(slide: HomeSlide) {
    const draft = drafts[slide.id];
    if (!draft) return;
    await patchSlide(slide.id, {
      alt: draft.alt,
      link_url: draft.link_url.trim() === "" ? null : draft.link_url.trim(),
    });
  }

  async function removeSlide(slide: HomeSlide) {
    const ok = window.confirm(
      `確定刪除這張輪播圖？\n（圖片檔會一併從儲存空間移除）`
    );
    if (!ok) return;

    setBusyId(slide.id);
    setError(null);
    setNotice(null);
    try {
      const data = await requestJson<{ message?: string }>("/api/admin/slides", {
        method: "POST",
        body: { action: "remove", id: slide.id },
      });
      if (!aliveRef.current) return;
      setSlides((prev) => prev.filter((s) => s.id !== slide.id));
      setNotice(data.message ?? "已刪除輪播圖。");
      await load();
    } catch (err) {
      if (aliveRef.current) setError(errorMessage(err));
    } finally {
      if (aliveRef.current) setBusyId(null);
    }
  }

  /** 上下移：先樂觀更新畫面，失敗回滾並提示 */
  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= slides.length) return;

    const previous = slides;
    const next = [...slides];
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;

    setSlides(next);
    setReordering(true);
    setError(null);
    setNotice(null);
    try {
      await requestJson<Record<string, never>>("/api/admin/slides", {
        method: "POST",
        body: { action: "reorder", ids: next.map((s) => s.id) },
      });
      if (!aliveRef.current) return;
      setNotice("已更新輪播順序。");
      await load();
    } catch (err) {
      if (!aliveRef.current) return;
      setSlides(previous);
      setError(errorMessage(err));
    } finally {
      if (aliveRef.current) setReordering(false);
    }
  }

  const full = slides.length >= MAX_SLIDES;
  const busy = uploading !== null || reordering;

  return (
    <div className="min-w-0 space-y-5">
      {/* ===== 數量與規格 ===== */}
      <div className="card-dark min-w-0 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-white/85">
            目前 {slides.length} / {MAX_SLIDES} 張
          </p>
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
        <p className="mt-2 text-xs leading-relaxed text-white/60">
          建議 10–20 張，1600×900（16:9），單張壓縮後 &lt;300KB。整批上傳時系統會自動壓縮；
          iPhone 相片請先轉 JPG，或在相機設定改為「相容性最佳」。
        </p>
      </div>

      {/* ===== 上傳 ===== */}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        disabled={busy || full}
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) void handleFiles(files);
        }}
      />

      <button
        type="button"
        disabled={busy || full}
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
              {full ? "已達上限，請先刪除不需要的圖片" : "點擊選擇圖片（可多選）"}
            </span>
            <span className="text-[11px] text-white/45">
              一次最多 {MAX_FILES_PER_BATCH} 張，jpg／png／webp
            </span>
          </>
        )}
      </button>

      {/* ===== 提示（不可靜默） ===== */}
      {error && (
        <div
          role="alert"
          className="min-w-0 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-red-200"
        >
          <span className="break-words">{error}</span>
        </div>
      )}
      {notice && (
        <p
          role="status"
          aria-live="polite"
          className="flex items-start gap-1.5 text-xs text-emerald-300"
        >
          <CheckCircle2 size={14} className="mt-0.5 flex-none" />
          <span className="min-w-0 break-words">{notice}</span>
        </p>
      )}

      {/* ===== 載入中 ===== */}
      {loading && slides.length === 0 && (
        <div role="status" className="px-1 py-4 text-center">
          <Loader2 size={18} className="mx-auto animate-spin text-white/50" />
          <p className="mt-2 text-xs text-white/55">正在讀取輪播圖…</p>
          {slow && (
            <p className="mt-1 text-[11px] text-white/45">
              比平常慢，可以按「重新整理」再試。
            </p>
          )}
        </div>
      )}

      {/* ===== 空狀態 ===== */}
      {!loading && slides.length === 0 && !error && (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-5 text-center text-xs leading-relaxed text-white/60">
          還沒有輪播圖。上傳 10–20 張首頁形象圖，就會自動顯示在首頁主視覺下方。
        </p>
      )}

      {/* ===== 清單 ===== */}
      {slides.length > 0 && (
        <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {slides.map((slide, index) => {
            const url = publicAssetUrl(slide.path);
            const draft = drafts[slide.id] ?? {
              alt: slide.alt,
              link_url: slide.link_url ?? "",
            };
            const rowBusy = busyId === slide.id;
            const disabled = busy || rowBusy;
            const dirty =
              draft.alt !== slide.alt ||
              draft.link_url !== (slide.link_url ?? "");

            return (
              <li
                key={slide.id}
                className="min-w-0 overflow-hidden rounded-xl border border-ink-line bg-black/25"
              >
                <div className="relative aspect-[16/9] w-full overflow-hidden bg-black/40">
                  {url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={url}
                      alt={slide.alt}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center text-[11px] text-white/40">
                      預覽不可用（圖片網址未設定）
                    </span>
                  )}
                  <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white/85">
                    {index + 1}
                  </span>
                  {!slide.is_active && (
                    <span className="absolute right-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">
                      已停用
                    </span>
                  )}
                </div>

                <div className="min-w-0 space-y-2.5 p-3">
                  <label className="block min-w-0">
                    <span className="mb-1 block text-[11px] font-semibold text-white/60">
                      替代文字（必填）
                    </span>
                    <input
                      value={draft.alt}
                      maxLength={120}
                      disabled={disabled}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [slide.id]: { ...draft, alt: e.target.value },
                        }))
                      }
                      placeholder="例如：會員在館內進行街頭健身訓練"
                      className="field min-w-0 px-2.5 py-1.5 text-xs"
                    />
                  </label>

                  <label className="block min-w-0">
                    <span className="mb-1 block text-[11px] font-semibold text-white/60">
                      連結（選填，只接受 / 開頭）
                    </span>
                    <input
                      value={draft.link_url}
                      maxLength={300}
                      disabled={disabled}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [slide.id]: { ...draft, link_url: e.target.value },
                        }))
                      }
                      placeholder="/events"
                      className="field min-w-0 px-2.5 py-1.5 text-xs"
                    />
                  </label>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={disabled || index === 0}
                      onClick={() => void move(index, -1)}
                      aria-label={`把第 ${index + 1} 張往上移`}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/25 text-white/80 transition hover:border-white/60 disabled:opacity-35"
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      type="button"
                      disabled={disabled || index === slides.length - 1}
                      onClick={() => void move(index, 1)}
                      aria-label={`把第 ${index + 1} 張往下移`}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-white/25 text-white/80 transition hover:border-white/60 disabled:opacity-35"
                    >
                      <ArrowDown size={15} />
                    </button>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={slide.is_active}
                      aria-label={`第 ${index + 1} 張是否啟用`}
                      disabled={disabled}
                      onClick={() => void toggleActive(slide)}
                      className={`inline-flex min-h-11 items-center rounded-lg border px-2.5 text-[11px] font-semibold transition disabled:opacity-45 ${
                        slide.is_active
                          ? "border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/15"
                          : "border-white/25 text-white/60 hover:bg-white/5"
                      }`}
                    >
                      {slide.is_active ? "啟用中" : "已停用"}
                    </button>

                    <button
                      type="button"
                      disabled={disabled || !dirty}
                      onClick={() => void saveDraft(slide)}
                      className="btn-base btn-ghost min-h-11 px-2.5 py-1.5 text-[11px] disabled:opacity-45"
                    >
                      {rowBusy ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <>
                          <Save size={13} /> 儲存
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void removeSlide(slide)}
                      aria-label={`刪除第 ${index + 1} 張輪播圖`}
                      className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-red-500/45 text-red-300 transition hover:bg-red-500/15 disabled:opacity-45"
                    >
                      <Trash2 size={15} />
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
