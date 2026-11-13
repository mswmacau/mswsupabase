"use client";

/**
 * src/app/admin/hyrox/HyroxAdmin.tsx — HYROX 後台（場次管理 ＋ 付款審核 兩個分頁）
 *
 * 資料來源：
 *   · 場次列表：Server 外殼已用 getHyroxEvents({includeArchived:true}) 取好當初始值，
 *     這層再打 GET /api/admin/hyrox/events 補上「報名數／待審數」統計
 *     （統計只有那支端點有，一次查回全部場次）。
 *   · 付款名單：GET /api/admin/hyrox/registrations?event_id=<uuid>（逐場取），
 *     所以付款審核分頁要先選場次——由 PaymentReview 自己負責。
 *
 * 邊界：載入中（3 秒後補文字）、錯誤（可重試）、空狀態（兩個分頁都有文案）。
 *
 * 客戶實測回饋（「按上架無反應」）的三個修正：
 *   1. 儲存成功後在列表頂部顯示「已儲存（狀態：已上架）」，3 秒後淡出；
 *      並同時 loadEvents() + router.refresh()，卡片狀態即時反映。
 *   2. 每張卡加一鍵「上架／下架」（直接 POST update 只改 status），有 loading 與結果提示。
 *   3. 儲存／上架失敗一律顯示可讀錯誤（之前非 200 完全靜默）。
 *      卡片上的「未上傳收款碼」改成可點 → 開啟編輯並滾到收款 QR 區。
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  CalendarDays,
  ClipboardCheck,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Users,
} from "lucide-react";
import { AdminError, AdminNotice } from "@/components/admin/ui";
import { getHyrox, postHyrox } from "@/components/hyrox/api";
import {
  eventDateValue,
  feeLabel,
  type HyroxEvent,
  type HyroxEventWithCounts,
} from "@/components/hyrox/shared";
import { formatDate } from "@/lib/utils";
import { HyroxEventForm } from "./HyroxEventForm";
import { PaymentReview } from "./PaymentReview";

type Tab = "events" | "payments";

const EVENT_STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  published: "已上架",
  archived: "已下架",
};

const EVENT_STATUS_CLASS: Record<string, string> = {
  draft: "bg-white/10 text-neutral-300 border-white/20",
  published: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  archived: "bg-white/5 text-white/45 border-white/15",
};

export function HyroxAdmin({ initialEvents }: { initialEvents: HyroxEvent[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("events");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeFading, setNoticeFading] = useState(false);

  /**
   * 場次列表。初始值來自 Server 外殼（沒有統計），載入後換成含統計的版本。
   * router.refresh() 之後 server prop 會變，用 render 期間比對同步（不寫 effect）。
   */
  const [events, setEvents] = useState<HyroxEventWithCounts[]>(
    initialEvents.map((e) => ({ ...e, registrations_count: 0, pending_count: 0 }))
  );
  const [syncedFrom, setSyncedFrom] = useState<HyroxEvent[]>(initialEvents);
  if (syncedFrom !== initialEvents) {
    setSyncedFrom(initialEvents);
    setEvents(
      initialEvents.map((e) => ({ ...e, registrations_count: 0, pending_count: 0 }))
    );
  }

  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setSlow(false);
    setError(null);
    const res = await getHyrox<{ events?: HyroxEventWithCounts[] }>(
      "/api/admin/hyrox/events"
    );
    if (res.ok && res.events) setEvents(res.events);
    else if (!res.ok) setError(res.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    async function run() {
      await loadEvents();
    }
    void run();
  }, [loadEvents]);

  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [loading]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HyroxEvent | null>(null);
  /** 表單開啟後要直接跳到的欄位（"qr" = 收款 QR） */
  const [formFocus, setFormFocus] = useState<"qr" | null>(null);

  /** 一鍵上架／下架的處理中場次，與失敗訊息 */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /** 成功提示：3 秒後淡出，3.6 秒後移除（手動關閉也可以） */
  useEffect(() => {
    if (!notice) return;
    const fade = setTimeout(() => setNoticeFading(true), 3000);
    const clear = setTimeout(() => setNotice(null), 3600);
    return () => {
      clearTimeout(fade);
      clearTimeout(clear);
    };
  }, [notice]);

  /** 出新提示：先把上一次的淡出狀態歸零（不在 effect 內同步 setState） */
  function showNotice(message: string) {
    setNoticeFading(false);
    setNotice(message);
  }

  function dismissNotice() {
    setNoticeFading(false);
    setNotice(null);
  }

  function openForm(event: HyroxEvent | null, focus: "qr" | null = null) {
    setEditing(event);
    setFormFocus(focus);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setFormFocus(null);
  }

  /**
   * 一鍵改狀態。送完整欄位而不是只送 status：
   * 後端 update 的必填檢查我們看不到，寧願把列表已知的值一併送回，避免
   * 「只改狀態」被判成缺欄位而失敗。
   */
  async function toggleStatus(event: HyroxEventWithCounts) {
    const nextStatus: HyroxEvent["status"] =
      event.status === "published" ? "archived" : "published";
    const actionLabel = nextStatus === "published" ? "上架" : "下架";

    setBusyId(event.id);
    setActionError(null);
    dismissNotice();

    const res = await postHyrox<{ message?: string }>(
      "/api/admin/hyrox/events",
      {
        action: "update",
        id: event.id,
        title: event.title,
        subtitle: event.subtitle,
        body: event.body,
        event_date: event.event_date,
        end_date: event.end_date,
        start_time: event.start_time,
        end_time: event.end_time,
        location: event.location,
        capacity: event.capacity,
        registration_url: event.registration_url,
        registration_note: event.registration_note,
        cover_path: event.cover_path,
        sort_order: event.sort_order,
        fee_cents: event.fee_cents,
        payment_qr_path: event.payment_qr_path,
        payment_phone: event.payment_phone,
        payment_note: event.payment_note,
        status: nextStatus,
      }
    );

    setBusyId(null);

    if (!res.ok) {
      setActionError(`「${event.title}」${actionLabel}失敗：${res.error}`);
      return;
    }

    // 先樂觀更新卡片狀態（不等伺服器回來的那一輪），再向伺服器對齊
    setEvents((prev) =>
      prev.map((row) =>
        row.id === event.id ? { ...row, status: nextStatus } : row
      )
    );
    showNotice(`「${event.title}」已${actionLabel}。`);
    await loadEvents();
    router.refresh();
  }

  const pendingTotal = events.reduce((n, e) => n + (e.pending_count ?? 0), 0);

  return (
    <div className="min-w-0 space-y-5">
      {notice && (
        <div
          className={`sticky top-2 z-30 transition-opacity duration-500 ${
            noticeFading ? "opacity-0" : "opacity-100"
          }`}
        >
          <AdminNotice message={notice} onDismiss={dismissNotice} />
        </div>
      )}

      {actionError && (
        <AdminError message={actionError} onDismiss={() => setActionError(null)} />
      )}

      {/* 分頁 */}
      <div
        role="tablist"
        aria-label="HYROX 管理分頁"
        className="flex flex-wrap gap-2 border-b border-ink-line pb-2"
      >
        <TabButton
          id="tab-events"
          active={tab === "events"}
          onClick={() => setTab("events")}
          icon={<CalendarDays size={15} />}
          label="場次管理"
        />
        <TabButton
          id="tab-payments"
          active={tab === "payments"}
          onClick={() => setTab("payments")}
          icon={<ClipboardCheck size={15} />}
          label={`付款審核${pendingTotal > 0 ? `（${pendingTotal}）` : ""}`}
        />
      </div>

      {/* ===== 場次管理 ===== */}
      {tab === "events" && (
        <section
          role="tabpanel"
          aria-labelledby="tab-events"
          className="min-w-0 space-y-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-white/60">
              共 {events.length} 場 HYROX 場次（含草稿與已下架）。
              日期留空的場次，前台會顯示「日期待定」。
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void loadEvents();
                  router.refresh();
                }}
                disabled={loading}
                className="btn-base btn-ghost px-3 py-2 text-sm disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                重新整理
              </button>
              <button
                type="button"
                onClick={() => openForm(null)}
                className="btn-base btn-cobalt px-4 py-2 text-sm"
              >
                <Plus size={16} /> 新增場次
              </button>
            </div>
          </div>

          {error && <AdminError message={error} onDismiss={() => setError(null)} />}

          {loading && events.length === 0 && (
            <div
              role="status"
              aria-live="polite"
              className="card-dark px-4 py-10 text-center"
            >
              <Loader2 size={22} className="mx-auto animate-spin text-white/60" />
              <p className="mt-3 text-sm text-white/70">正在讀取場次…</p>
              {slow && (
                <p className="mt-1 text-xs text-white/50">
                  比平常慢，可以按「重新整理」再試。
                </p>
              )}
            </div>
          )}

          {!loading && events.length === 0 ? (
            <div className="card-dark px-4 py-14 text-center">
              <CalendarDays size={26} className="mx-auto text-white/30" />
              <p className="mt-3 text-sm text-white/75">還沒有 HYROX 場次。</p>
              <p className="mt-1 text-xs text-white/50">
                按「新增場次」建立第一場；日期可以留空，之後再補。
              </p>
              <button
                type="button"
                onClick={() => openForm(null)}
                className="btn-base btn-cobalt mt-5 px-4 py-2 text-sm"
              >
                <Plus size={16} /> 新增場次
              </button>
            </div>
          ) : (
            <ul className="space-y-3">
              {events.map((e) => {
                const date = eventDateValue(e.event_date);
                return (
                  <li key={e.id} className="card-dark min-w-0 p-4 md:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="min-w-0 break-words text-sm font-bold text-white/90">
                            {e.title}
                          </h3>
                          <span
                            className={`slab border px-2.5 py-0.5 text-[11px] font-bold ${
                              EVENT_STATUS_CLASS[e.status] ?? EVENT_STATUS_CLASS.draft
                            }`}
                          >
                            {EVENT_STATUS_LABEL[e.status] ?? e.status}
                          </span>
                        </div>

                        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                          <Cell k="日期" v={date ? formatDate(date) : "待定"} />
                          <Cell k="費用" v={feeLabel(e.fee_cents)} />
                          <Cell k="名額" v={e.capacity ? `${e.capacity} 人` : "不限"} />
                          <Cell k="地點" v={e.location || "—"} />
                        </dl>

                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-white/60">
                          <span className="inline-flex items-center gap-1.5">
                            <Users size={13} className="text-vital-bright" />
                            報名 {e.registrations_count ?? 0}
                          </span>
                          {e.pending_count > 0 ? (
                            <span className="inline-flex items-center gap-1.5 text-amber-300">
                              待審 {e.pending_count}
                            </span>
                          ) : (
                            <span className="text-white/40">待審 0</span>
                          )}
                          {e.payment_qr_path ? (
                            <span className="text-white/40">收款碼已上傳</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openForm(e, "qr")}
                              className="inline-flex min-h-11 items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/20"
                            >
                              <AlertTriangle size={13} className="flex-none" />
                              未上傳收款碼（點擊上傳）
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex w-full flex-none flex-col gap-2 sm:w-auto">
                        <button
                          type="button"
                          onClick={() => openForm(e)}
                          disabled={busyId === e.id}
                          className="btn-base btn-ghost min-h-11 w-full px-3 py-2 text-sm sm:w-auto"
                        >
                          <Pencil size={15} /> 編輯
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleStatus(e)}
                          disabled={busyId === e.id}
                          className={`btn-base min-h-11 w-full px-3 py-2 text-sm sm:w-auto ${
                            e.status === "published" ? "btn-ghost" : "btn-cobalt"
                          } disabled:opacity-60`}
                        >
                          {busyId === e.id ? (
                            <>
                              <Loader2 size={15} className="animate-spin" /> 處理中…
                            </>
                          ) : e.status === "published" ? (
                            <>
                              <ArrowDownCircle size={15} /> 下架
                            </>
                          ) : (
                            <>
                              <ArrowUpCircle size={15} /> 上架
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* ===== 付款審核 ===== */}
      {tab === "payments" && (
        <section role="tabpanel" aria-labelledby="tab-payments" className="min-w-0">
          <PaymentReview events={events} />
        </section>
      )}

      {formOpen && (
        <HyroxEventForm
          event={editing}
          focus={formFocus}
          onClose={closeForm}
          onSaved={(msg) => {
            showNotice(msg);
            void loadEvents();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function TabButton({
  id,
  active,
  onClick,
  icon,
  label,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-2 px-3.5 text-sm font-semibold transition ${
        active
          ? "slab bg-white/10 text-white"
          : "text-white/60 hover:bg-white/5 hover:text-white"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.14em] text-white/40">{k}</dt>
      <dd className="min-w-0 break-words text-white/80">{v}</dd>
    </div>
  );
}
