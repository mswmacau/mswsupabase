"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { AssetUploader } from "@/components/AssetUploader";
import type { Coach } from "@/lib/queries";

/**
 * 後台教練管理：新增 / 編輯 / 刪除 / 顯示開關 / 相片上載
 *
 * 設計：
 *  - 列表與表單同一頁，點「編輯」把資料帶進表單，點「取消」清空
 *  - 相片沿用既有 AssetUploader（kind="coach"，走 site-assets bucket）
 *  - 所有動作打 /api/admin/coaches（後端會再驗一次管理員身分）
 *  - 失敗時顯示錯誤訊息，不靜默失敗
 */

const EMPTY = {
  id: "",
  name: "",
  specialty: "",
  bio: "",
  photo_path: "",
  sort_order: 0,
  is_visible: true,
};

export function CoachManager({ coaches }: { coaches: Coach[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ ...EMPTY });
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function startEdit(c: Coach) {
    setForm({
      id: c.id,
      name: c.name,
      specialty: c.specialty ?? "",
      bio: c.bio ?? "",
      photo_path: c.photo_path ?? "",
      sort_order: c.sort_order ?? 0,
      is_visible: c.is_visible,
    });
    setEditing(true);
    setError(null);
    setSuccess(null);
  }

  function cancelEdit() {
    setForm({ ...EMPTY });
    setEditing(false);
    setError(null);
  }

  async function save() {
    if (!form.name.trim()) {
      setError("請填寫教練姓名。");
      return;
    }
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/coaches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id || undefined,
          name: form.name.trim(),
          specialty: form.specialty.trim(),
          bio: form.bio.trim(),
          photo_path: form.photo_path || null,
          sort_order: form.sort_order,
          is_visible: form.is_visible,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; message?: string };
      if (!data.ok) {
        setError(data.error ?? "儲存失敗。");
        return;
      }
      setSuccess(data.message ?? "已儲存。");
      cancelEdit();
      router.refresh();
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`確定刪除教練「${name}」？此動作無法復原。`)) return;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/admin/coaches?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { ok: boolean; error?: string; message?: string };
      if (!data.ok) {
        setError(data.error ?? "刪除失敗。");
        return;
      }
      setSuccess(data.message ?? "已刪除。");
      router.refresh();
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-8">
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
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

      {/* ===== 表單 ===== */}
      <div className="rounded-xl border border-ink-line p-5">
        <h3 className="text-base font-bold">
          {editing ? "編輯教練" : "新增教練"}
        </h3>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="coach-name">
              姓名 *
            </label>
            <input
              id="coach-name"
              className="field"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="教練姓名"
            />
          </div>
          <div>
            <label className="label" htmlFor="coach-specialty">
              專長
            </label>
            <input
              id="coach-specialty"
              className="field"
              value={form.specialty}
              onChange={(e) => set("specialty", e.target.value)}
              placeholder="例：Street Workout"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="coach-bio">
              簡介
            </label>
            <textarea
              id="coach-bio"
              className="field min-h-[100px]"
              value={form.bio}
              onChange={(e) => set("bio", e.target.value)}
              placeholder="教練背景、教學風格、資歷等"
            />
          </div>
          <div>
            <label className="label" htmlFor="coach-sort">
              排序（數字小者在前）
            </label>
            <input
              id="coach-sort"
              className="field"
              type="number"
              value={form.sort_order}
              onChange={(e) => set("sort_order", Number(e.target.value) || 0)}
            />
          </div>
          <div className="flex items-end">
            <label className="flex min-h-11 items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={form.is_visible}
                onChange={(e) => set("is_visible", e.target.checked)}
                className="h-4 w-4"
              />
              前台顯示
            </label>
          </div>
          <div className="sm:col-span-2">
            <span className="label">相片</span>
            <AssetUploader
              kind="coach"
              aspect="1/1"
              value={form.photo_path || null}
              onChange={(path) => set("photo_path", path ?? "")}
              hint="建議用直式方形構圖，系統會自動壓縮"
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="btn-base btn-cobalt"
          >
            {pending ? (
              <>
                <Loader2 size={17} className="animate-spin" /> 儲存中…
              </>
            ) : (
              <>
                <Save size={17} /> 儲存
              </>
            )}
          </button>
          {editing && (
            <button type="button" onClick={cancelEdit} className="btn-base btn-ghost">
              <X size={17} /> 取消編輯
            </button>
          )}
        </div>
      </div>

      {/* ===== 列表 ===== */}
      <div>
        <h3 className="text-base font-bold">已建立教練（{coaches.length}）</h3>

        {coaches.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/60">
            尚無教練資料。請用上方表單新增。
            <br />
            （若已執行 migration 卻仍無法新增，請確認 Supabase 的 coaches 表已建立）
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {coaches.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-4 rounded-xl border border-ink-line px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">
                    {c.name}
                    {!c.is_visible && (
                      <span className="ml-2 text-xs font-normal text-white/45">
                        （前台隱藏）
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-white/60">
                    {c.specialty ? `${c.specialty} · ` : ""}
                    排序 {c.sort_order}
                    {c.photo_path ? " · 有相片" : " · 無相片"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(c)}
                    disabled={pending}
                    className="btn-base btn-ghost !px-3 !py-1.5 text-xs"
                  >
                    編輯
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(c.id, c.name)}
                    disabled={pending}
                    className="btn-base btn-ghost !px-3 !py-1.5 text-xs !text-red-300"
                  >
                    <Trash2 size={14} /> 刪除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-white/50">
        <Plus size={12} className="mr-1 inline" />
        提示：教練姓名、專長、簡介的正式文字建議先向教練本人與活動負責人確認後再填寫。
      </p>
    </div>
  );
}
