"use client";

/**
 * src/app/admin/events/AlbumLinksEditor.tsx — 「更多相簿」連結清單管理（F-08 後台半）
 *
 * 端點（B-08，白客）：
 *   GET    /api/admin/events/[id]/album-links        → { ok, links: [...] }
 *   POST   /api/admin/events/[id]/album-links        { url, label }（上限 5）
 *   DELETE /api/admin/events/[id]/album-links        { id }
 *
 * 位置：RaceForm 第三段（進階）相簿網址卡內、主連結欄位之後。
 * 主相簿 events.album_url 的既有欄位零改動——本表是「主按鈕之下的按鈕列」。
 *
 * 為什麼只有編輯模式才渲染：連結需要 event_id，新增中的賽事還沒有 id
 * （與 RaceForm 組別編輯同一條紀律：先存檔再掛子資料，避免半套資料）。
 *
 * 前台顯示：每筆一顆外開按鈕（label 命名）——雲相簿的 X-Frame-Options
 * 全擋 iframe，所以一律 target="_blank"（方案 §3.1 定案），這裡只負責存。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Link2, Loader2, Plus, Trash2 } from "lucide-react";
import { deleteJson, postJson } from "@/lib/fetch-json";

/** 每場上限（方案 §3.2：0–5 筆；與 API 的 409 同口徑） */
const MAX_LINKS = 5;

/** API 回傳的一筆連結 */
export interface AlbumLink {
  id: string;
  url: string;
  label: string;
  sort_order: number;
}

export function AlbumLinksEditor({ eventId }: { eventId: string }) {
  const [links, setLinks] = useState<AlbumLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** seq 守衛：快速操作時舊回應不會蓋新清單 */
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    setSlow(false);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/events/${encodeURIComponent(eventId)}/album-links`,
        { headers: { "Content-Type": "application/json" } }
      );
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; links?: AlbumLink[] }
        | null;
      if (seq !== seqRef.current) return;
      if (!data || data.ok === false) {
        setLinks([]);
        // migration 未跑 → 400 SCHEMA_OUTDATED 的可讀訊息照實顯示
        setError(
          data && typeof data.error === "string"
            ? data.error
            : "讀取相簿連結失敗，請稍後再試。"
        );
      } else {
        setLinks(Array.isArray(data.links) ? data.links : []);
      }
    } catch {
      if (seq !== seqRef.current) return;
      setLinks([]);
      setError("網路中斷，請檢查連線後再試。");
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    async function run() {
      await load();
    }
    void run();
  }, [load]);

  // 超過 3 秒給文字說明
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [loading]);

  const full = links.length >= MAX_LINKS;

  async function onAdd() {
    const u = url.trim();
    const l = label.trim();
    setFieldError(null);
    setNotice(null);
    if (!/^https?:\/\//.test(u) || u.length > 500) {
      setFieldError("連結必須是 http／https 開頭（500 字內）。");
      return;
    }
    if (l.length < 1 || l.length > 40) {
      setFieldError("按鈕文字 1–40 字（例如「攝影師 A」）。");
      return;
    }
    if (full) {
      setFieldError(`每場最多 ${MAX_LINKS} 筆連結。`);
      return;
    }
    setAdding(true);
    try {
      await postJson<{ ok: true }>(
        `/api/admin/events/${encodeURIComponent(eventId)}/album-links`,
        { url: u, label: l }
      );
      setLabel("");
      setUrl("");
      setNotice("已新增相簿連結。");
      await load();
    } catch (err) {
      setFieldError(
        err instanceof Error ? err.message : "新增失敗，請稍後再試。"
      );
    } finally {
      setAdding(false);
    }
  }

  async function onDelete(id: string) {
    setDeletingId(id);
    setNotice(null);
    try {
      await deleteJson(
        `/api/admin/events/${encodeURIComponent(eventId)}/album-links`,
        { id }
      );
      setNotice("已刪除該筆連結。");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除失敗，請稍後再試。");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-ink-line bg-black/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-bold text-white/85">
          <Link2 size={15} className="text-vital-bright" /> 更多相簿連結
        </p>
        <span className="text-xs tabular-nums text-white/50">
          {links.length}/{MAX_LINKS} 筆
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-white/55">
        相片模式下，前台會在主相簿按鈕下面顯示這些連結（各自開新視窗）。
        適合放多位攝影師的雲端相簿。
      </p>

      {notice && (
        <p className="mt-3 text-xs text-emerald-300" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="mt-3 break-words text-xs text-amber-300" role="alert">
          {error}
        </p>
      )}

      {/* 載入 */}
      {loading && (
        <p className="mt-3 flex items-center gap-2 text-sm text-white/60" role="status">
          <Loader2 size={15} className="animate-spin" aria-hidden /> 讀取連結中…
          {slow && <span className="text-xs text-white/50">比平常慢，請稍候。</span>}
        </p>
      )}

      {/* 既有連結清單 */}
      {!loading && links.length > 0 && (
        <ul className="mt-3 space-y-2">
          {links.map((lk) => (
            <li
              key={lk.id}
              className="flex min-h-11 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white/85" title={lk.label}>
                  {lk.label}
                </p>
                <p className="truncate font-mono text-xs text-white/45" title={lk.url}>
                  {lk.url}
                </p>
              </div>
              <a
                href={lk.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 flex-none items-center px-2 text-white/50 transition hover:text-white"
                aria-label={`另開 ${lk.label}（新視窗）`}
              >
                <ExternalLink size={14} aria-hidden />
              </a>
              <button
                type="button"
                onClick={() => void onDelete(lk.id)}
                disabled={deletingId === lk.id}
                className="inline-flex min-h-11 flex-none items-center gap-1 rounded px-2 text-xs text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200 disabled:opacity-50"
                aria-label={`刪除 ${lk.label}`}
              >
                {deletingId === lk.id ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                ) : (
                  <Trash2 size={14} aria-hidden />
                )}
                刪除
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 新增列（未滿 5 筆才顯示） */}
      {!loading && !full && (
        <div className="mt-3 space-y-2">
          <div>
            <label className="label" htmlFor="al-label">
              按鈕文字（1–40 字）
            </label>
            <input
              id="al-label"
              className="field"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={40}
              placeholder="例如：攝影師 A"
            />
          </div>
          <div>
            <label className="label" htmlFor="al-url">
              相簿連結（http／https）
            </label>
            <input
              id="al-url"
              className="field"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={500}
              inputMode="url"
              placeholder="https://photos.example.com/..."
            />
          </div>
          {fieldError && (
            <p className="text-xs text-red-300" role="alert">
              {fieldError}
            </p>
          )}
          <button
            type="button"
            onClick={() => void onAdd()}
            disabled={adding}
            className="btn-base btn-cobalt min-h-11 w-full text-sm disabled:opacity-60"
          >
            {adding ? (
              <>
                <Loader2 size={15} className="animate-spin" aria-hidden /> 新增中…
              </>
            ) : (
              <>
                <Plus size={15} aria-hidden /> 新增連結
              </>
            )}
          </button>
        </div>
      )}

      {!loading && full && (
        <p className="mt-3 text-xs text-white/50">
          已達上限 {MAX_LINKS} 筆；要再加請先刪掉一筆。
        </p>
      )}
    </div>
  );
}
