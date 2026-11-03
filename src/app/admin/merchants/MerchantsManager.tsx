"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  KeyRound,
  Loader2,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Store,
} from "lucide-react";
import { FetchError, postJson } from "@/lib/fetch-json";
import { AdminError, AdminModal, AdminNotice, ConfirmDialog, Field } from "@/components/admin/ui";
import { PinDialog } from "./PinDialog";
import type { MerchantRow } from "./types";

/**
 * 商戶列表與操作。
 *  - PIN 狀態只顯示「有沒有、有效到幾時」，永不顯示 hash 或舊 PIN。
 *  - 產生／重設 PIN 走 PinDialog（明文只顯示一次，需勾「已抄下」才可關閉）。
 *  - 停用商戶要二次確認：停用後店員無法用此商戶核銷，但已有券仍可改由其他商戶／後台處理。
 */
export function MerchantsManager({ initialMerchants }: { initialMerchants: MerchantRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<MerchantRow[]>(initialMerchants);
  const [syncedFrom, setSyncedFrom] = useState(initialMerchants);

  // router.refresh() 只更新 server prop，不會更新 useState 初始值。
  // React 官方做法：在 render 期間比對 prop，變了就同步 state（不是副作用，不會多跑一次 commit）。
  if (syncedFrom !== initialMerchants) {
    setSyncedFrom(initialMerchants);
    setRows(initialMerchants);
  }

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [pinTarget, setPinTarget] = useState<MerchantRow | null>(null);
  const [stopTarget, setStopTarget] = useState<MerchantRow | null>(null);
  const [stopPending, setStopPending] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function afterChange(message: string) {
    setNotice(message);
    setError(null);
    router.refresh();
  }

  async function toggleStatus(row: MerchantRow, status: "active" | "inactive") {
    setBusyId(row.id);
    setError(null);
    try {
      const data = await postJson<{ message?: string }>("/api/admin/merchants", {
        action: "status",
        id: row.id,
        status,
      });
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status } : r)));
      afterChange(data.message ?? (status === "active" ? "商戶已啟用。" : "商戶已停用。"));
    } catch (err) {
      setError(err instanceof FetchError ? err.message : "網路錯誤，請稍後再試。");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmStop() {
    if (!stopTarget) return;
    setStopPending(true);
    setStopError(null);
    try {
      await toggleStatus(stopTarget, "inactive");
      setStopTarget(null);
    } finally {
      setStopPending(false);
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      {error && <AdminError message={error} onDismiss={() => setError(null)} />}
      {notice && <AdminNotice message={notice} onDismiss={() => setNotice(null)} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-white/60">
          共 {rows.length} 間商戶，{rows.filter((r) => r.status === "active").length} 間啟用中。
          PIN 遺失或懷疑外洩時，請直接重設。
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setRefreshing(true);
              router.refresh();
              setTimeout(() => setRefreshing(false), 800);
            }}
            className="btn-base btn-ghost px-3 py-2 text-sm"
            aria-label="重新整理商戶列表"
          >
            {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            重新整理
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="btn-base btn-cobalt px-4 py-2 text-sm"
          >
            <Plus size={16} /> 新增商戶
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 px-4 py-14 text-center">
          <Store size={26} className="mx-auto text-white/30" />
          <p className="mt-3 text-sm text-white/70">尚未新增任何核銷商戶。</p>
          <p className="mt-1 text-xs text-white/50">
            新增商戶後要為它產生 PIN，店員才能用該商戶的身分核銷電子券。
          </p>
        </div>
      ) : (
        <>
          <div className="hidden min-w-0 overflow-x-auto rounded-xl border border-ink-line md:block">
            <table className="w-full min-w-[860px] text-sm">
              <caption className="sr-only">商戶列表，共 {rows.length} 間</caption>
              <thead className="bg-ink-soft text-left text-xs text-white/60">
                <tr>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">商戶名稱</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">聯絡備註</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">PIN 狀態</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 font-semibold">狀態</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-3 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-line">
                {rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="px-3 py-3 font-semibold">{row.name}</td>
                    <td className="max-w-[260px] px-3 py-3 text-white/70">
                      {row.contact_note ? (
                        <span className="line-clamp-2">{row.contact_note}</span>
                      ) : (
                        <span className="text-white/35">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <PinStatus row={row} />
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                          row.status === "active"
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                            : "border-white/20 bg-white/5 text-white/55"
                        }`}
                      >
                        {row.status === "active" ? "啟用" : "停用"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPinTarget(row)}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-semibold text-white/85 transition hover:border-white/45 hover:text-white"
                        >
                          <KeyRound size={13} />
                          {row.has_pin && !row.must_reset ? "重設 PIN" : "產生 PIN"}
                        </button>
                        {row.status === "active" ? (
                          <button
                            type="button"
                            disabled={busyId === row.id}
                            onClick={() => {
                              setStopError(null);
                              setStopTarget(row);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 px-2.5 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/10 disabled:opacity-50"
                          >
                            {busyId === row.id ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <PowerOff size={13} />
                            )}
                            停用
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busyId === row.id}
                            onClick={() => void toggleStatus(row, "active")}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 px-2.5 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/10 disabled:opacity-50"
                          >
                            {busyId === row.id ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Power size={13} />
                            )}
                            啟用
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {rows.map((row) => (
              <li key={row.id} className="card-dark p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate font-semibold">{row.name}</p>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                      row.status === "active"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : "border-white/20 bg-white/5 text-white/55"
                    }`}
                  >
                    {row.status === "active" ? "啟用" : "停用"}
                  </span>
                </div>
                {row.contact_note && (
                  <p className="mt-1 line-clamp-2 text-xs text-white/55">{row.contact_note}</p>
                )}
                <div className="mt-2">
                  <PinStatus row={row} />
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPinTarget(row)}
                    className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-white/15 px-3 text-xs font-semibold text-white/85"
                  >
                    <KeyRound size={13} /> {row.has_pin && !row.must_reset ? "重設 PIN" : "產生 PIN"}
                  </button>
                  {row.status === "active" ? (
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => {
                        setStopError(null);
                        setStopTarget(row);
                      }}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-amber-500/40 px-3 text-xs font-semibold text-amber-200 disabled:opacity-50"
                    >
                      <PowerOff size={13} /> 停用
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void toggleStatus(row, "active")}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-emerald-500/40 px-3 text-xs font-semibold text-emerald-200 disabled:opacity-50"
                    >
                      <Power size={13} /> 啟用
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {createOpen && (
        <CreateMerchantDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(name) => {
            afterChange(`已新增商戶「${name}」，請記得為它產生 PIN。`);
            setCreateOpen(false);
          }}
        />
      )}

      {pinTarget && (
        <PinDialog
          merchant={pinTarget}
          onClose={() => {
            setPinTarget(null);
            router.refresh();
          }}
          onIssued={(message) => {
            setNotice(message);
            setError(null);
            setRows((prev) =>
              prev.map((r) =>
                r.id === pinTarget?.id
                  ? { ...r, has_pin: true, must_reset: false }
                  : r
              )
            );
          }}
        />
      )}

      {stopTarget && (
        <ConfirmDialog
          title={`停用「${stopTarget.name}」`}
          confirmLabel="確認停用"
          tone="warn"
          pending={stopPending}
          error={stopError}
          requireCheck="我了解停用後店員將無法用此商戶核銷新的電子券。"
          description={
            <div className="space-y-2">
              <ul className="list-disc space-y-1 pl-5 text-white/70">
                <li>停用後，這間商戶不再出現在禮品的「核銷商戶」下拉選單。</li>
                <li>店員用此商戶身分核銷時會被拒絕。</li>
                <li>已發出的券不會消失，仍可由後台代為核銷或改由其他商戶處理。</li>
              </ul>
              <p className="text-xs text-white/55">
                系統不提供刪除商戶：商戶一旦被禮品或兌換紀錄引用，硬刪會被外鍵擋住。
              </p>
            </div>
          }
          onCancel={() => setStopTarget(null)}
          onConfirm={() => void confirmStop()}
        />
      )}
    </div>
  );
}

function PinStatus({ row }: { row: MerchantRow }) {
  const expires = row.pin_expires_at ? new Date(row.pin_expires_at).getTime() : null;
  const expired = expires !== null && !Number.isNaN(expires) && expires < new Date().getTime();

  if (!row.has_pin || row.must_reset) {
    return (
      <span
        className="inline-flex whitespace-nowrap rounded-full border border-amber-500/45 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-200"
        title="尚未設定可用的 PIN，店員目前無法核銷"
      >
        {row.must_reset ? "需重設" : "未設定"}
      </span>
    );
  }

  if (expires === null) {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
        已設定（無到期）
      </span>
    );
  }

  if (expired) {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full border border-red-500/45 bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-300">
        已過期（{formatMacauDate(row.pin_expires_at!)}）
      </span>
    );
  }

  return (
    <span className="inline-flex whitespace-nowrap rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
      有效至 {formatMacauDate(row.pin_expires_at!)}
    </span>
  );
}

function formatMacauDate(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const d = new Date(t + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function CreateMerchantDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [contactNote, setContactNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit() {
    setError(null);
    setFields({});
    if (!name.trim()) {
      setFields({ name: "請填商戶名稱。" });
      return;
    }
    setPending(true);
    try {
      await postJson<{ message?: string }>("/api/admin/merchants", {
        action: "create",
        name: name.trim(),
        contact_note: contactNote.trim(),
      });
      onCreated(name.trim());
    } catch (err) {
      if (err instanceof FetchError) {
        setError(err.message);
        if (err.fields) setFields(err.fields);
      } else {
        setError("網路錯誤，請稍後再試。");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title="新增核銷商戶"
      description="新增後要為它產生 PIN，店員才能用該商戶身分核銷。"
      dismissible={!pending}
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className="btn-base btn-ghost">
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={pending}
            className="btn-base btn-cobalt"
          >
            {pending ? (
              <>
                <Loader2 size={16} className="animate-spin" /> 新增中…
              </>
            ) : (
              "新增商戶"
            )}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <AdminError message={error} onDismiss={() => setError(null)} />}
        <Field label="商戶名稱" htmlFor="merchant-name" error={fields.name}>
          <input
            id="merchant-name"
            className="field"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：MSW 街健館（自營）"
            data-autofocus
          />
        </Field>
        <Field
          label="聯絡備註"
          htmlFor="merchant-note"
          hint="只供後台參考，不會顯示給會員。"
          error={fields.contact_note}
        >
          <textarea
            id="merchant-note"
            className="field min-h-20"
            value={contactNote}
            maxLength={200}
            onChange={(event) => setContactNote(event.target.value)}
            placeholder="聯絡人、電話、地址等"
          />
        </Field>
      </div>
    </AdminModal>
  );
}
