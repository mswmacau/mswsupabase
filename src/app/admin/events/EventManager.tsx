"use client";

/**
 * src/app/admin/events/EventManager.tsx — 活動 CRUD + 上下架 + 軟刪除 + 復原
 *
 * Owner：方砚。對齊 SPEC-R6.md §2.3–2.5、FE-6：
 *  - 列表顯示全部非 archived 活動（含 status 徽章）
 *  - 新增後列表立即出現（router.refresh）
 *  - 上架/下架/復原按鈕即時變換
 *  - 「已下架」篩選器可看到 archived 並一鍵復原
 *  - 刪除需勾選「確認下架此活動」才能執行
 *  - 封面「確認移除封面？」對話框 + 送 removeCover:true
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Loader2,
  Pencil,
  Plus,
  Rocket,
  Trash2,
} from "lucide-react";
import type { Event, EventStatus } from "@/lib/types";
import { AssetUploader } from "@/components/AssetUploader";
import { deleteJson, FetchError, patchJson, postJson } from "@/lib/fetch-json";
import { formatDate } from "@/lib/utils";

interface FormState {
  title: string;
  subtitle: string;
  body: string;
  event_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  location: string;
  capacity: string;
  registration_url: string;
  registration_note: string;
  cover_path: string | null;
  status: "draft" | "published";
  sort_order: string;
}

function emptyForm(): FormState {
  return {
    title: "",
    subtitle: "",
    body: "",
    event_date: "",
    end_date: "",
    start_time: "",
    end_time: "",
    location: "",
    capacity: "",
    registration_url: "",
    registration_note: "",
    cover_path: null,
    status: "draft",
    sort_order: "0",
  };
}

const STATUS_BADGE: Record<EventStatus, { label: string; cls: string }> = {
  draft: {
    label: "草稿",
    cls: "border-white/25 bg-white/10 text-white/70",
  },
  published: {
    label: "已上架",
    cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  },
  archived: {
    label: "已下架",
    cls: "border-red-500/40 bg-red-500/15 text-red-300",
  },
};

function buildPayload(form: FormState, editing: Event | null) {
  const payload: Record<string, unknown> = {};
  const textKeys = [
    "title",
    "subtitle",
    "body",
    "event_date",
    "end_date",
    "start_time",
    "end_time",
    "location",
    "registration_url",
    "registration_note",
  ] as const;
  for (const k of textKeys) {
    const v = (form[k] ?? "").trim();
    payload[k] = v === "" ? null : v;
  }
  payload.capacity =
    form.capacity === "" || form.capacity == null ? null : Number(form.capacity);
  payload.sort_order =
    form.sort_order === "" || form.sort_order == null
      ? 0
      : Number(form.sort_order);
  payload.cover_path = form.cover_path ?? null;
  payload.status = form.status;
  if (editing) {
    payload.id = editing.id;
    if (
      form.cover_path === null &&
      (editing.cover_path ?? null) !== null
    ) {
      payload.removeCover = true;
    }
  }
  return payload;
}

export function EventManager({ events }: { events: Event[] }) {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Event | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);

  const visible = showArchived ? events : events.filter((e) => e.status !== "archived");
  const archivedCount = events.filter((e) => e.status === "archived").length;

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setFields({});
    setError(null);
    setSuccess(null);
    setFormOpen(true);
  }

  function openEdit(ev: Event) {
    setEditing(ev);
    setForm({
      title: ev.title,
      subtitle: ev.subtitle ?? "",
      body: ev.body ?? "",
      event_date: ev.event_date,
      end_date: ev.end_date ?? "",
      start_time: ev.start_time ?? "",
      end_time: ev.end_time ?? "",
      location: ev.location ?? "",
      capacity: ev.capacity == null ? "" : String(ev.capacity),
      registration_url: ev.registration_url ?? "",
      registration_note: ev.registration_note ?? "",
      cover_path: ev.cover_path ?? null,
      status: ev.status === "published" ? "published" : "draft",
      sort_order: String(ev.sort_order),
    });
    setFields({});
    setError(null);
    setSuccess(null);
    setFormOpen(true);
  }

  function onCoverChange(next: string | null) {
    const original = editing?.cover_path ?? null;
    if (next === null && original) {
      if (!window.confirm("確認移除封面？此動作會在儲存後刪除舊圖。")) return;
    }
    setForm((f) => ({ ...f, cover_path: next }));
  }

  async function submit() {
    setPending(true);
    setError(null);
    setFields({});
    try {
      const payload = buildPayload(form, editing);
      const res = editing
        ? await patchJson<{ ok: true; message: string }>(
            "/api/admin/events",
            payload
          )
        : await postJson<{ ok: true; message: string }>(
            "/api/admin/events",
            payload
          );
      setSuccess(res.message ?? "已儲存。");
      setFormOpen(false);
      setEditing(null);
      router.refresh();
    } catch (e) {
      if (e instanceof FetchError && e.fields) setFields(e.fields);
      setError(e instanceof Error ? e.message : "儲存失敗，請稍後再試。");
    } finally {
      setPending(false);
    }
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const inputCls =
    "field";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={openCreate}
            className="btn-base btn-vital text-sm"
          >
            <Plus size={16} /> 新增活動
          </button>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-white/70">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-vital)]"
            />
            顯示已下架（{archivedCount}）
          </label>
        </div>
        {success && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-200">
            {success}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* 列表 */}
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 px-6 py-14 text-center text-sm text-white/45">
          {showArchived
            ? "目前沒有活動。"
            : "目前沒有上架中的活動，點擊「新增活動」開始建立。"}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((ev) => (
            <EventRow
              key={ev.id}
              ev={ev}
              onEdit={() => openEdit(ev)}
              onChanged={(msg) => {
                setSuccess(msg);
                router.refresh();
              }}
              onError={(msg) => setError(msg)}
            />
          ))}
        </div>
      )}

      {/* 新增 / 編輯表單 */}
      {formOpen && (
        <div className="fixed inset-0 z-[70] overflow-y-auto bg-ink/80 backdrop-blur-sm">
          <div className="mx-auto my-10 w-full max-w-3xl px-4">
            <div className="card-dark p-6 md:p-8">
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-xl font-bold">
                  {editing ? "編輯活動" : "新增活動"}
                </h3>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white/70 transition hover:border-white/40"
                >
                  關閉
                </button>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="f-title">
                    活動標題 *
                  </label>
                  <input
                    id="f-title"
                    className={inputCls}
                    value={form.title}
                    onChange={(e) => setField("title", e.target.value)}
                    maxLength={120}
                  />
                  {fields.title && (
                    <p className="mt-1 text-xs text-red-300">{fields.title}</p>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label className="label" htmlFor="f-subtitle">
                    副標（選填）
                  </label>
                  <input
                    id="f-subtitle"
                    className={inputCls}
                    value={form.subtitle}
                    onChange={(e) => setField("subtitle", e.target.value)}
                    maxLength={200}
                  />
                </div>

                <div>
                  <label className="label" htmlFor="f-date">
                    活動日期 *
                  </label>
                  <input
                    id="f-date"
                    type="date"
                    className={inputCls}
                    value={form.event_date}
                    onChange={(e) => setField("event_date", e.target.value)}
                  />
                  {fields.event_date && (
                    <p className="mt-1 text-xs text-red-300">
                      {fields.event_date}
                    </p>
                  )}
                </div>

                <div>
                  <label className="label" htmlFor="f-end">
                    結束日期（選填）
                  </label>
                  <input
                    id="f-end"
                    type="date"
                    className={inputCls}
                    value={form.end_date}
                    onChange={(e) => setField("end_date", e.target.value)}
                  />
                  {fields.end_date && (
                    <p className="mt-1 text-xs text-red-300">
                      {fields.end_date}
                    </p>
                  )}
                </div>

                <div>
                  <label className="label" htmlFor="f-start">
                    開始時間（選填）
                  </label>
                  <input
                    id="f-start"
                    className={inputCls}
                    value={form.start_time}
                    onChange={(e) => setField("start_time", e.target.value)}
                    maxLength={20}
                  />
                </div>

                <div>
                  <label className="label" htmlFor="f-endt">
                    結束時間（選填）
                  </label>
                  <input
                    id="f-endt"
                    className={inputCls}
                    value={form.end_time}
                    onChange={(e) => setField("end_time", e.target.value)}
                    maxLength={20}
                  />
                </div>

                <div>
                  <label className="label" htmlFor="f-loc">
                    地點（選填）
                  </label>
                  <input
                    id="f-loc"
                    className={inputCls}
                    value={form.location}
                    onChange={(e) => setField("location", e.target.value)}
                    maxLength={120}
                  />
                </div>

                <div>
                  <label className="label" htmlFor="f-cap">
                    名額（選填，空 = 不限）
                  </label>
                  <input
                    id="f-cap"
                    type="number"
                    className={inputCls}
                    value={form.capacity}
                    onChange={(e) => setField("capacity", e.target.value)}
                    min={1}
                    max={99999}
                  />
                  {fields.capacity && (
                    <p className="mt-1 text-xs text-red-300">
                      {fields.capacity}
                    </p>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label className="label" htmlFor="f-url">
                    報名連結（選填，需 https:// / mailto: / tel:）
                  </label>
                  <input
                    id="f-url"
                    className={inputCls}
                    value={form.registration_url}
                    onChange={(e) =>
                      setField("registration_url", e.target.value)
                    }
                    maxLength={500}
                  />
                  {fields.registration_url && (
                    <p className="mt-1 text-xs text-red-300">
                      {fields.registration_url}
                    </p>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label className="label" htmlFor="f-note">
                    報名方式文字（選填；與連結擇一必填）
                  </label>
                  <textarea
                    id="f-note"
                    className={`${inputCls} min-h-20 resize-y`}
                    value={form.registration_note}
                    onChange={(e) =>
                      setField("registration_note", e.target.value)
                    }
                    maxLength={300}
                  />
                  {fields.registration_note && (
                    <p className="mt-1 text-xs text-red-300">
                      {fields.registration_note}
                    </p>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label className="label" htmlFor="f-body">
                    活動內文（選填）
                  </label>
                  <textarea
                    id="f-body"
                    className={`${inputCls} min-h-24 resize-y`}
                    value={form.body}
                    onChange={(e) => setField("body", e.target.value)}
                    maxLength={5000}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="label">封面圖片（建議 16:9，1600×900 以上）</label>
                  <AssetUploader
                    kind="event"
                    value={form.cover_path}
                    onChange={onCoverChange}
                    aspect="16/9"
                    hint="長邊超過 1600px 會自動壓縮；不支援 iPhone HEIC。"
                  />
                  {fields.cover_path && (
                    <p className="mt-1 text-xs text-red-300">
                      {fields.cover_path}
                    </p>
                  )}
                </div>

                <div>
                  <label className="label" htmlFor="f-status">
                    上架狀態
                  </label>
                  <select
                    id="f-status"
                    className={inputCls}
                    value={form.status}
                    onChange={(e) =>
                      setField(
                        "status",
                        e.target.value as "draft" | "published"
                      )
                    }
                  >
                    <option value="draft">草稿（不上架）</option>
                    <option value="published">直接上架</option>
                  </select>
                </div>

                <div>
                  <label className="label" htmlFor="f-sort">
                    排序（數字小者在前）
                  </label>
                  <input
                    id="f-sort"
                    type="number"
                    className={inputCls}
                    value={form.sort_order}
                    onChange={(e) => setField("sort_order", e.target.value)}
                  />
                </div>
              </div>

              <div className="mt-7 flex items-center gap-3">
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending}
                  className="btn-base btn-vital"
                >
                  {pending ? (
                    <>
                      <Loader2 size={17} className="animate-spin" /> 儲存中…
                    </>
                  ) : (
                    "儲存活動"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="btn-base btn-ghost"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EventRow({
  ev,
  onEdit,
  onChanged,
  onError,
}: {
  ev: Event;
  onEdit: () => void;
  onChanged: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const badge = STATUS_BADGE[ev.status];

  async function act(
    fn: () => Promise<{ ok: true; message: string }>,
    key: string
  ) {
    setPending(key);
    try {
      const res = await fn();
      onChanged(res.message);
    } catch (e) {
      onError(e instanceof Error ? e.message : "操作失敗，請稍後再試。");
    } finally {
      setPending(null);
      setConfirm(false);
    }
  }

  const toggleStatus: EventStatus =
    ev.status === "published" ? "draft" : "published";

  return (
    <div className="card-dark flex flex-wrap items-center gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{ev.title}</span>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}
          >
            {badge.label}
          </span>
        </div>
        <div className="mt-1 text-xs text-white/45">
          {formatDate(ev.event_date)}
          {ev.location ? ` · ${ev.location}` : ""}
          {ev.registration_url || ev.registration_note
            ? " · 有報名方式"
            : " · 尚無報名方式"}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ev.status !== "archived" && (
          <>
            <button
              type="button"
              disabled={pending !== null}
              onClick={() =>
                act(
                  () =>
                    patchJson("/api/admin/events", {
                      id: ev.id,
                      status: toggleStatus,
                      statusOnly: true,
                    }),
                  "toggle"
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:border-white/40 disabled:opacity-50"
            >
              {pending === "toggle" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : ev.status === "published" ? (
                <>
                  <Archive size={14} /> 下架
                </>
              ) : (
                <>
                  <Rocket size={14} /> 上架
                </>
              )}
            </button>

            <button
              type="button"
              disabled={pending !== null}
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:border-white/40 disabled:opacity-50"
            >
              <Pencil size={14} /> 編輯
            </button>
          </>
        )}

        {ev.status === "archived" ? (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() =>
              act(
                () =>
                  patchJson("/api/admin/events", {
                    id: ev.id,
                    status: "published",
                    statusOnly: true,
                  }),
                "recover"
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-50"
          >
            {pending === "recover" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <>
                <ArchiveRestore size={14} /> 復原
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            disabled={pending === "del" || !confirm}
            onClick={() =>
              act(
                () =>
                  deleteJson("/api/admin/events", {
                    id: ev.id,
                    confirm: true,
                  }),
                "del"
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
          >
            {pending === "del" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <>
                <Trash2 size={14} /> 下架隱藏
              </>
            )}
          </button>
        )}
      </div>

      {ev.status !== "archived" && (
        <label className="flex w-full items-center gap-2 text-xs text-white/50 sm:w-auto">
          <input
            type="checkbox"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-vital)]"
          />
          勾選「確認下架此活動」後才能執行
        </label>
      )}
    </div>
  );
}
