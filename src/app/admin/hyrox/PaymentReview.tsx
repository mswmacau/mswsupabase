"use client";

/**
 * src/app/admin/hyrox/PaymentReview.tsx — 付款審核（逐場）
 *
 * 端點（與白客已實作的 route 對齊）：
 *   GET  /api/admin/hyrox/registrations?event_id=<uuid>
 *        → { ok:true, event:{id,title}, registrations: HyroxAdminRegistrationRow[] }
 *   POST /api/admin/hyrox/review
 *        → { registration_id, decision:"confirmed"|"rejected", note? }
 *
 * 為什麼要先選場次：後端那支 GET 需要 event_id（一次回一場的名單，
 * 避免管理員一次拉幾百筆含個資的列）。
 *
 * 390 寬：卡片堆疊，不用表格。截圖縮圖點開用後台既有 AdminModal（Esc／焦點鎖），
 * 不引入任何新依賴。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  Download,
  ExternalLink,
  ImageOff,
  Loader2,
  RefreshCw,
  UserCheck,
  X,
} from "lucide-react";
import { AdminError, AdminModal, AdminNotice } from "@/components/admin/ui";
import { PaymentBadge } from "@/components/hyrox/PaymentBadge";
import { getHyrox, postHyrox } from "@/components/hyrox/api";
import {
  eventDateValue,
  groupLabel,
  type HyroxAdminRegistrationRow,
  type HyroxEvent,
} from "@/components/hyrox/shared";
import { formatDate, formatDateTime } from "@/lib/utils";

/**
 * 名單一列：既有 HyroxAdminRegistrationRow 再補 attended_at
 * （白客的 GET 已回此欄；migration 未跑時一律 null）。
 * 只在本檔擴充型別，不動 src/components/hyrox/shared.ts。
 */
type RowWithAttendance = HyroxAdminRegistrationRow & {
  /** 已點名時間（ISO）；null = 未點名／功能未啟用 */
  attended_at: string | null;
};

/**
 * PATCH 出席點名（本檔專用薄包裝）。
 * 為什麼不用 components/hyrox/api.ts 的 getHyrox／postHyrox：它們只支援
 * GET/POST，而這支端點是 PATCH。回傳判別式聯集，呼叫端不會漏接錯誤。
 */
async function patchAttendance(
  registrationId: string,
  attended: boolean
): Promise<{ ok: true } | { ok: false; status: number; code?: string; error: string }> {
  try {
    const res = await fetch(
      `/api/admin/hyrox/registrations/${encodeURIComponent(registrationId)}/attendance`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attended }),
      }
    );
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return {
        ok: false,
        status: res.status,
        error: `伺服器回應異常（HTTP ${res.status}），請稍後再試。`,
      };
    }
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string; code?: string }
      | null;
    if (!data) {
      return { ok: false, status: res.status, error: "伺服器回應異常，請稍後再試。" };
    }
    if (data.ok === true) return { ok: true };
    return {
      ok: false,
      status: res.status,
      code: typeof data.code === "string" ? data.code : undefined,
      error: typeof data.error === "string" ? data.error : "操作失敗，請稍後再試。",
    };
  } catch {
    return { ok: false, status: 0, error: "網路中斷，請檢查連線後再試。" };
  }
}

const GENDER_LABEL: Record<string, string> = {
  male: "男",
  female: "女",
  undisclosed: "不透露",
};

export function PaymentReview({ events }: { events: HyroxEvent[] }) {
  const router = useRouter();

  /** 預設選第一場已上架的場次（沒有就選列表第一場） */
  const defaultEventId =
    events.find((e) => e.status === "published")?.id ?? events[0]?.id ?? "";
  const [eventId, setEventId] = useState(defaultEventId);

  const [rows, setRows] = useState<RowWithAttendance[]>([]);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(
    null
  );
  const [rejectTarget, setRejectTarget] =
    useState<HyroxAdminRegistrationRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [rejectPending, setRejectPending] = useState(false);

  /**
   * 出席點名是否可用（migration-event-attendance.sql 有沒有跑）。
   * null = 尚未探測；true = 可用；false = 未啟用（按鈕 disabled＋小字說明）。
   */
  const [attendanceEnabled, setAttendanceEnabled] = useState<boolean | null>(null);
  const [attendanceBusyId, setAttendanceBusyId] = useState<string | null>(null);

  /**
   * 取某一場的名單（effect 與「重新整理」共用）。
   * seq 守衛：快速切換場次時，較慢回來的舊請求不會蓋掉新名單。
   */
  const seqRef = useRef(0);
  const fetchRows = useCallback(async (id: string) => {
    const seq = ++seqRef.current;
    if (!id) {
      setRows([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSlow(false);
    setError(null);
    const res = await getHyrox<{ registrations?: RowWithAttendance[] }>(
      `/api/admin/hyrox/registrations?event_id=${encodeURIComponent(id)}`
    );
    if (seq !== seqRef.current) return; // 已經換場次，丟掉這個回應
    if (res.ok) {
      setRows(res.registrations ?? []);
    } else {
      setRows([]);
      setError(res.error);
    }
    setLoading(false);
  }, []);

  // 換場次就重新取數
  useEffect(() => {
    async function run() {
      await fetchRows(eventId);
    }
    void run();
  }, [eventId, fetchRows]);

  /**
   * 探測「出席點名」是否已啟用（migration 未跑時端點回 503 SCHEMA_OUTDATED）。
   *
   * 為什麼用「不存在的 uuid + attended:false」探一次：
   *   · 端點順序是 授權 → 參數 → 讀取（含 attended_at 欄位）→ 找不到才回 404，
   *     所以欄位不存在時會先回 503，而不是 404 —— 兩態可分。
   *   · uuid 不存在 ⇒ 一定在「讀不到就 404」就結束，不會寫入任何資料。
   * GET 名單在 migration 未跑時 attended_at 一律 null，與「全部未點名」
   * 無法區分，所以不能只看名單欄位。
   */
  useEffect(() => {
    let alive = true;
    const probeId = "00000000-0000-4000-8000-000000000000";
    void patchAttendance(probeId, false).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setAttendanceEnabled(true);
        return;
      }
      // 503 / SCHEMA_OUTDATED = 功能未啟用；404 = 端點正常（這筆不存在而已）
      setAttendanceEnabled(!(res.status === 503 || res.code === "SCHEMA_OUTDATED"));
    });
    return () => {
      alive = false;
    };
  }, []);

  // 超過 3 秒給文字說明，而不是只有轉圈（重設在 fetchRows 內做）
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [loading]);

  async function review(
    row: HyroxAdminRegistrationRow,
    decision: "confirmed" | "rejected",
    note?: string
  ) {
    setBusyId(row.registration_id);
    setActionError(null);
    const res = await postHyrox<{
      message?: string;
      registration?: { id: string; payment_status: string };
      award?: { points?: number; skipped?: boolean; reason?: string } | null;
    }>("/api/admin/hyrox/review", {
      registration_id: row.registration_id,
      decision,
      ...(note ? { note } : {}),
    });
    setBusyId(null);

    if (!res.ok) {
      setActionError(res.error);
      return false;
    }

    setRows((prev) =>
      prev.map((r) =>
        r.registration_id === row.registration_id
          ? {
              ...r,
              payment_status: decision,
              admin_note:
                decision === "rejected" ? note ?? r.admin_note : r.admin_note,
            }
          : r
      )
    );

    // 後端發分結果在 award 裡（RPC 回傳）；跳過發分時也照實講，不要假裝發了
    const points = res.award?.points;
    const awarded =
      typeof points === "number" && points > 0
        ? `，並發放 ${points} 積分`
        : res.award?.skipped
          ? "（積分未重複發放）"
          : "";
    setNotice(
      res.message ??
        (decision === "confirmed"
          ? `已確認收款${awarded}。`
          : "已拒絕，會員可以重新上傳轉帳證明。")
    );
    router.refresh();
    return true;
  }

  async function confirmReject() {
    if (!rejectTarget) return;
    const note = rejectNote.trim();
    if (note.length < 2) {
      setRejectError("請填寫拒絕原因（至少 2 個字），會員會看到這段文字。");
      return;
    }
    setRejectPending(true);
    setRejectError(null);
    const ok = await review(rejectTarget, "rejected", note);
    setRejectPending(false);
    if (ok) {
      setRejectTarget(null);
      setRejectNote("");
    }
  }

  /**
   * 出席切換：點名／撤回。成功只更新那一列（不整頁 reload）。
   * 503（migration 未跑）→ 把整頁切成「未啟用」並用小字說明，
   * 不彈錯誤框（站主要的是「知到未開」，不是紅字嚇人）。
   */
  async function toggleAttendance(row: RowWithAttendance) {
    const next = !row.attended_at;
    setAttendanceBusyId(row.registration_id);
    setActionError(null);
    const res = await patchAttendance(row.registration_id, next);
    setAttendanceBusyId(null);

    if (!res.ok) {
      if (res.status === 503 || res.code === "SCHEMA_OUTDATED") {
        setAttendanceEnabled(false);
        return;
      }
      setActionError(res.error);
      return;
    }

    const nowIso = new Date().toISOString();
    setRows((prev) =>
      prev.map((r) =>
        r.registration_id === row.registration_id
          ? { ...r, attended_at: next ? nowIso : null }
          : r
      )
    );
    const who = row.full_name || row.display_name || "這位會員";
    setNotice(next ? `已為 ${who} 點名出席。` : `已取消 ${who} 的出席點名。`);
  }

  const pendingRows = rows.filter((r) => r.payment_status === "pending_review");
  const rejectedRows = rows.filter((r) => r.payment_status === "rejected");
  const confirmedCount = rows.filter((r) => r.payment_status === "confirmed").length;
  const shownError = actionError ?? error;

  /* 連一場都沒有 → 先請管理員建立場次 */
  if (events.length === 0) {
    return (
      <div className="card-dark px-4 py-14 text-center">
        <ImageOff size={26} className="mx-auto text-white/30" />
        <p className="mt-3 text-sm text-white/75">還沒有場次可以審核。</p>
        <p className="mt-1 text-xs text-white/50">
          先到「場次管理」建立一場 HYROX，報名進來後這裡才會有名單。
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      {shownError && (
        <AdminError message={shownError} onDismiss={() => setActionError(null)} />
      )}
      {notice && <AdminNotice message={notice} onDismiss={() => setNotice(null)} />}

      {/* 場次選擇 ＋ 重新整理 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 sm:max-w-sm">
          <label className="label" htmlFor="review-event">
            選擇場次
          </label>
          <select
            id="review-event"
            className="field"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
          >
            {events.map((e) => {
              const d = eventDateValue(e.event_date);
              return (
                <option key={e.id} value={e.id}>
                  {e.title}
                  {d ? `（${formatDate(d)}）` : "（日期待定）"}
                </option>
              );
            })}
          </select>
        </div>
        <button
          type="button"
          onClick={() => void fetchRows(eventId)}
          disabled={loading}
          aria-busy={loading}
          className="btn-base btn-ghost px-3 py-2 text-sm disabled:opacity-60"
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          重新整理
        </button>
        {/*
          匯出 CSV（G-1）：純 <a download> 讓瀏覽器自己下載，不用 fetch+blob
          （iOS Safari 會把 blob 下載吃掉；同 RaceRoster 的既有做法）。
          端點：GET /api/admin/hyrox/registrations/export?event_id=&type=roster
          （UTF-8 BOM＋RFC5987 檔名，Excel 直開中文不亂碼）。
          390：外層 flex-col，這顆按鈕 w-full 全寬（§2.3 G-1）。
        */}
        <a
          href={`/api/admin/hyrox/registrations/export?event_id=${encodeURIComponent(eventId)}&type=roster`}
          download
          aria-disabled={!eventId}
          className={`btn-base btn-ghost min-h-11 w-full px-3 py-2 text-sm sm:w-auto ${
            eventId ? "" : "pointer-events-none opacity-50"
          }`}
        >
          <Download size={16} /> 匯出 CSV
        </a>
      </div>

      <p className="text-xs text-white/60">
        待審 {pendingRows.length} 筆，已拒絕 {rejectedRows.length} 筆，已確認{" "}
        {confirmedCount} 筆。確認收款會發 30 積分（金額由後端讀設定值）。
      </p>

      {/* 載入 */}
      {loading && (
        <div
          role="status"
          aria-live="polite"
          className="card-dark px-4 py-10 text-center"
        >
          <Loader2 size={22} className="mx-auto animate-spin text-white/60" />
          <p className="mt-3 text-sm text-white/70">正在讀取名單…</p>
          {slow && (
            <p className="mt-1 text-xs text-white/50">
              比平常慢，可以按「重新整理」再試一次。
            </p>
          )}
        </div>
      )}

      {/* 錯誤 → 可重試 */}
      {!loading && error && (
        <div className="card-dark px-4 py-10 text-center">
          <AlertCircle size={24} className="mx-auto text-red-300" />
          <p className="mt-3 break-words text-sm text-white/75">讀不到這場的名單。</p>
          <button
            type="button"
            onClick={() => void fetchRows(eventId)}
            className="btn-base btn-ghost mt-4 px-4 py-2 text-sm"
          >
            <RefreshCw size={15} /> 重試
          </button>
        </div>
      )}

      {/* 空狀態 */}
      {!loading && !error && pendingRows.length === 0 && rejectedRows.length === 0 && (
        <div className="card-dark px-4 py-14 text-center">
          <ImageOff size={26} className="mx-auto text-white/30" />
          <p className="mt-3 text-sm text-white/75">這一場沒有待審的付款。</p>
          <p className="mt-1 text-xs text-white/50">
            會員提交轉帳截圖後會出現在這裡；已確認的 {confirmedCount} 筆不再列出。
          </p>
        </div>
      )}

      {!loading && pendingRows.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.22em] text-amber-300">
            待審 · {pendingRows.length}
          </h3>
          {pendingRows.map((row) => (
            <ReviewCard
              key={row.registration_id}
              row={row}
              busy={busyId === row.registration_id}
              attendanceEnabled={attendanceEnabled}
              attendanceBusy={attendanceBusyId === row.registration_id}
              onToggleAttendance={() => void toggleAttendance(row)}
              onConfirm={() => void review(row, "confirmed")}
              onReject={() => {
                setRejectTarget(row);
                setRejectNote("");
                setRejectError(null);
              }}
              onZoom={setLightbox}
            />
          ))}
        </section>
      )}

      {!loading && rejectedRows.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.22em] text-red-300">
            已拒絕 · {rejectedRows.length}（等會員重交）
          </h3>
          {rejectedRows.map((row) => (
            <ReviewCard
              key={row.registration_id}
              row={row}
              busy={busyId === row.registration_id}
              attendanceEnabled={attendanceEnabled}
              attendanceBusy={attendanceBusyId === row.registration_id}
              onToggleAttendance={() => void toggleAttendance(row)}
              onConfirm={() => void review(row, "confirmed")}
              onReject={() => {
                setRejectTarget(row);
                setRejectNote(row.admin_note ?? "");
                setRejectError(null);
              }}
              onZoom={setLightbox}
            />
          ))}
        </section>
      )}

      {/* 大圖：沿用後台既有 Modal（Esc 關閉、焦點鎖在面板內） */}
      {lightbox && (
        <AdminModal
          title={lightbox.label}
          onClose={() => setLightbox(null)}
          width="max-w-3xl"
          footer={
            <>
              <a
                href={lightbox.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-base btn-ghost"
              >
                <ExternalLink size={15} /> 另開原圖
              </a>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="btn-base btn-cobalt"
              >
                關閉
              </button>
            </>
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.url}
            alt="轉帳證明大圖"
            className="max-h-[70vh] w-full bg-white object-contain"
          />
        </AdminModal>
      )}

      {/* 拒絕原因 */}
      {rejectTarget && (
        <AdminModal
          title="拒絕這筆付款"
          description="原因會顯示給會員，請寫清楚要補什麼（例如截圖看不到金額）。"
          onClose={() => {
            if (!rejectPending) setRejectTarget(null);
          }}
          dismissible={!rejectPending}
          footer={
            <>
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                disabled={rejectPending}
                className="btn-base btn-ghost"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void confirmReject()}
                disabled={rejectPending}
                className="btn-base btn-vital"
              >
                {rejectPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> 處理中…
                  </>
                ) : (
                  <>
                    <X size={16} /> 確定拒絕
                  </>
                )}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            {rejectError && <AdminError message={rejectError} />}
            <label className="label" htmlFor="reject-note">
              拒絕原因（會員可見）
            </label>
            <textarea
              id="reject-note"
              className="field min-h-24"
              maxLength={500}
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="例如：截圖看不到轉帳金額，請重新上傳完整截圖。"
            />
            <p className="text-xs text-white/50">{rejectNote.length} / 500</p>
          </div>
        </AdminModal>
      )}
    </div>
  );
}

/** 一筆報名：390 卡片直排，sm 以上左圖右資料 */
function ReviewCard({
  row,
  busy,
  attendanceEnabled,
  attendanceBusy,
  onToggleAttendance,
  onConfirm,
  onReject,
  onZoom,
}: {
  row: RowWithAttendance;
  busy: boolean;
  /** null = 探測中；false = migration 未跑（點名 disabled＋小字） */
  attendanceEnabled: boolean | null;
  attendanceBusy: boolean;
  onToggleAttendance: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onZoom: (v: { url: string; label: string }) => void;
}) {
  const name = row.full_name || row.display_name || "未填姓名";
  /**
   * signed URL 只有 1 小時效期：名單開著不動、或儲存空間暫時取不到圖時，
   * 縮圖會變成一張破圖（alt 文字還會撐高卡片）。失敗就退回佔位框，
   * 讓管理員知道「有截圖但載不到」，而不是看到一片破圖。
   */
  const [imgFailed, setImgFailed] = useState(false);
  const showProof = Boolean(row.proof_url) && !imgFailed;

  return (
    <article className="card-dark min-w-0 p-4 md:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 sm:w-28 sm:flex-none">
          {showProof ? (
            <button
              type="button"
              onClick={() =>
                onZoom({ url: row.proof_url!, label: `${name} 的轉帳證明` })
              }
              className="block w-full overflow-hidden border border-ink-line bg-black/40 transition hover:border-white/40"
              aria-label={`查看 ${name} 的轉帳證明大圖`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={row.proof_url!}
                alt={`${name} 的轉帳證明`}
                loading="lazy"
                decoding="async"
                onError={() => setImgFailed(true)}
                className="h-24 w-full object-cover sm:h-28"
              />
            </button>
          ) : (
            <div className="flex h-24 w-full items-center justify-center border border-dashed border-white/20 bg-black/30 px-2 text-center text-[11px] leading-relaxed text-white/45 sm:h-28">
              {row.proof_url
                ? "截圖載入失敗，請重新整理"
                : "未上傳截圖"}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-words text-sm font-bold text-white/90">
              {name}
            </span>
            <PaymentBadge status={row.payment_status} size="sm" />
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
            <Cell k="性別" v={GENDER_LABEL[row.gender ?? ""] ?? "—"} />
            <Cell k="電話" v={row.phone || "—"} mono />
            <Cell k="身份證後四位" v={row.id_last4 || "—"} mono />
            <Cell k="組別" v={groupLabel(row.group_pref)} />
            <Cell k="每週運動" v={row.weekly_freq || "—"} />
            <Cell k="最長跑距" v={row.longest_run || "—"} />
            <Cell k="報名時間" v={formatDateTime(row.created_at)} />
            <Cell
              k="自填金額"
              v={
                row.payment_amount_cents != null
                  ? `MOP ${(row.payment_amount_cents / 100).toFixed(
                      row.payment_amount_cents % 100 === 0 ? 0 : 2
                    )}`
                  : "—"
              }
            />
          </dl>

          {row.admin_note && (
            <p className="mt-3 break-words border-l-2 border-red-500/60 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-200">
              退回原因：{row.admin_note}
            </p>
          )}

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy || row.payment_status === "confirmed"}
              className="btn-base btn-vital min-h-11 w-full text-sm sm:w-auto"
            >
              {busy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Check size={15} />
              )}
              確認收款
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={busy}
              className="btn-base btn-ghost min-h-11 w-full text-sm text-red-300 sm:w-auto"
            >
              <X size={15} /> 拒絕
            </button>
          </div>

          {/* 出席點名（站主：邊個真係嚟到）。390 獨立一行，避免擠爆操作列 */}
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--line-fine)] pt-2">
            {attendanceEnabled === false ? (
              <>
                <button
                  type="button"
                  disabled
                  className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded border border-white/15 bg-white/[0.03] px-4 text-sm text-white/35 sm:w-auto"
                >
                  <UserCheck size={15} />
                  {row.attended_at ? "已出席" : "點名"}
                </button>
                <span className="text-[11px] text-white/45">出席功能未啟用</span>
              </>
            ) : row.attended_at ? (
              <button
                type="button"
                onClick={onToggleAttendance}
                disabled={attendanceBusy}
                aria-pressed
                aria-label={`取消 ${name} 的出席點名`}
                title="點一下可撤回點名"
                className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded border border-emerald-500/50 bg-emerald-500/15 px-4 text-sm font-bold text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-60 sm:w-auto"
              >
                {attendanceBusy ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <UserCheck size={15} />
                )}
                已出席
              </button>
            ) : (
              <button
                type="button"
                onClick={onToggleAttendance}
                disabled={attendanceBusy || attendanceEnabled === null}
                aria-label={`為 ${name} 點名出席`}
                className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded border border-white/20 bg-white/[0.03] px-4 text-sm text-white/75 transition hover:border-white/40 hover:text-white disabled:opacity-60 sm:w-auto"
              >
                {attendanceBusy ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <UserCheck size={15} />
                )}
                點名
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function Cell({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.14em] text-white/40">{k}</dt>
      <dd className={`min-w-0 break-words text-white/80 ${mono ? "stat-figure" : ""}`}>
        {v}
      </dd>
    </div>
  );
}
