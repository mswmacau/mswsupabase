"use client";

/**
 * src/components/hyrox/ResultsReview.tsx — 完賽成績審核（F-05 的 client 半）
 *
 * 端點（契約 §1.5-③④）：
 *   GET  /api/admin/hyrox/results?status=pending|approved|rejected
 *   POST /api/admin/hyrox/results/review { id, action, admin_note? }
 *
 * 互動模式逐段複製 PaymentReview（同一套視覺與守衛）：
 *   · seq 守衛防快速切換時舊回應蓋新名單；>3 秒給文字說明
 *   · busyId 防同列連點；AdminModal 拒絕原因（必填，Esc／焦點鎖）
 *   · 核可／拒絕成功訊息 = §5-11 凍結文案（已確認。／已拒絕。）
 *
 * 判重輔助（R-03：v1 不做自動判重，但把「相近成績」排在一起＋標提示）：
 * API 已按 division_code → race_date → finish_seconds 排序；前端再對
 * 「同類別同日、時間差 ≤ 5 秒」的相鄰列標「相近」小標，核可時人工只過一筆。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { AdminError, AdminModal, AdminNotice } from "@/components/admin/ui";
import { postHyrox, type HyroxApiResult } from "@/components/hyrox/api";
import { formatDate } from "@/lib/utils";

/** 管理端一列完賽提交（契約 §1.5-③；finish_label 已由 server 格式化） */
export interface AdminResultRow {
  id: string;
  display_name: string | null;
  division_code: string;
  division_label: string;
  race_name: string;
  race_date: string;
  finish_seconds: number;
  finish_label: string;
  team_name: string | null;
  teammates: string[];
  note: string | null;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
  created_at: string;
  proof_url: string;
}

type StatusFilter = "pending" | "approved" | "rejected";

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "pending", label: "待審核" },
  { key: "approved", label: "已確認" },
  { key: "rejected", label: "已拒絕" },
];

/** 相近成績判定門檻（秒）：同類別同日、相鄰兩列時間差 ≤ 此值 → 標「相近」 */
const NEAR_SECONDS = 5;

/** 與前一列「同類別、同日、時間相近」→ 核可時人工判重用 */
function isNear(prev: AdminResultRow, cur: AdminResultRow): boolean {
  return (
    prev.division_code === cur.division_code &&
    prev.race_date === cur.race_date &&
    Math.abs(prev.finish_seconds - cur.finish_seconds) <= NEAR_SECONDS
  );
}

/** 直接 fetch 名單（getHyrox 只包 GET，夠用） */
async function fetchList(
  status: StatusFilter
): Promise<HyroxApiResult<{ results?: AdminResultRow[] }>> {
  try {
    const res = await fetch(
      `/api/admin/hyrox/results?status=${status}`,
      { headers: { "Content-Type": "application/json" } }
    );
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return {
        ok: false,
        code: "BAD_RESPONSE",
        error: `伺服器回應異常（HTTP ${res.status}），請稍後再試。`,
      };
    }
    const data = (await res.json().catch(() => null)) as
      | ({ ok?: boolean; error?: string; results?: AdminResultRow[] } & Record<string, unknown>)
      | null;
    if (!data || typeof data !== "object") {
      return { ok: false, code: "BAD_RESPONSE", error: "伺服器回應異常，請稍後再試。" };
    }
    if (data.ok === false) {
      return {
        ok: false,
        code: String(data.code ?? "ERROR"),
        error: typeof data.error === "string" ? data.error : "讀取失敗，請稍後再試。",
      };
    }
    return { ok: true, results: Array.isArray(data.results) ? data.results : [] };
  } catch {
    return { ok: false, code: "NETWORK", error: "網路中斷，請檢查連線後再試。" };
  }
}

export function ResultsReview() {
  const router = useRouter();

  const [status, setStatus] = useState<StatusFilter>("pending");
  const [rows, setRows] = useState<AdminResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdminResultRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [rejectPending, setRejectPending] = useState(false);

  /** seq 守衛：快速切狀態時，較慢回來的舊請求不會蓋掉新名單 */
  const seqRef = useRef(0);
  const fetchRows = useCallback(async (s: StatusFilter) => {
    const seq = ++seqRef.current;
    setLoading(true);
    setSlow(false);
    setError(null);
    const res = await fetchList(s);
    if (seq !== seqRef.current) return;
    if (res.ok) {
      setRows(res.results ?? []);
    } else {
      setRows([]);
      setError(res.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    async function run() {
      await fetchRows(status);
    }
    void run();
  }, [status, fetchRows]);

  // 超過 3 秒給文字說明，而不是只有轉圈
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [loading]);

  async function approve(row: AdminResultRow) {
    setBusyId(row.id);
    setActionError(null);
    const res = await postHyrox<{ message?: string }>(
      "/api/admin/hyrox/results/review",
      { id: row.id, action: "approve" }
    );
    setBusyId(null);
    if (!res.ok) {
      setActionError(res.error);
      return;
    }
    // §5-11 凍結文案
    setNotice("已確認。");
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    router.refresh();
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
    const res = await postHyrox<{ message?: string }>(
      "/api/admin/hyrox/results/review",
      { id: rejectTarget.id, action: "reject", admin_note: note }
    );
    setRejectPending(false);
    if (!res.ok) {
      setActionError(res.error);
      setRejectTarget(null);
      return;
    }
    // §5-11 凍結文案
    setNotice("已拒絕。");
    setRows((prev) => prev.filter((r) => r.id !== rejectTarget.id));
    setRejectTarget(null);
    setRejectNote("");
    router.refresh();
  }

  const shownError = actionError ?? error;

  return (
    <div className="min-w-0 space-y-4">
      {shownError && (
        <AdminError message={shownError} onDismiss={() => setActionError(null)} />
      )}
      {notice && <AdminNotice message={notice} onDismiss={() => setNotice(null)} />}

      {/* 狀態過濾 chips ＋ 重新整理 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="狀態"
          className="flex flex-wrap gap-2"
        >
          {STATUS_TABS.map((tab) => {
            const active = status === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                aria-pressed={active}
                onClick={() => setStatus(tab.key)}
                className={`min-h-11 px-4 py-2 text-sm transition ${
                  active
                    ? "slab bg-vital font-bold text-white"
                    : "border border-white/15 bg-white/[0.03] text-white/70 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => void fetchRows(status)}
          disabled={loading}
          aria-busy={loading}
          className="btn-base btn-ghost min-h-11 px-3 py-2 text-sm disabled:opacity-60"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          重新整理
        </button>
      </div>

      <p className="text-xs leading-relaxed text-white/60">
        名單按「類別 → 比賽日 → 完賽時間」排序，時間相近的列會標「相近」——
        同隊兩人都提交時，核可其中一筆、另一筆拒絕即可（系統不做自動判重）。
      </p>

      {/* 載入 */}
      {loading && (
        <div role="status" aria-live="polite" className="card-dark px-4 py-10 text-center">
          <Loader2 size={22} className="mx-auto animate-spin text-white/60" />
          <p className="mt-3 text-sm text-white/70">正在讀取名單…</p>
          {slow && (
            <p className="mt-1 text-xs text-white/50">比平常慢，可以按「重新整理」再試一次。</p>
          )}
        </div>
      )}

      {/* 錯誤 → 可重試 */}
      {!loading && error && (
        <div className="card-dark px-4 py-10 text-center">
          <AlertCircle size={24} className="mx-auto text-red-300" />
          <p className="mt-3 break-words text-sm text-white/75">讀不到名單。</p>
          <button
            type="button"
            onClick={() => void fetchRows(status)}
            className="btn-base btn-ghost mt-4 min-h-11 px-4 py-2 text-sm"
          >
            <RefreshCw size={15} /> 重試
          </button>
        </div>
      )}

      {/* 空狀態（§1.5-⑥：名單空 → 凍結文案） */}
      {!loading && !error && rows.length === 0 && (
        <div className="card-dark px-4 py-14 text-center">
          <p className="text-sm text-white/75">目前沒有待審核的完賽成績。</p>
          <p className="mt-1 text-xs text-white/50">
            {status === "pending"
              ? "會員提交完賽截圖後會出現在這裡。"
              : "切換上方狀態可看其他名單。"}
          </p>
        </div>
      )}

      {/* 名單卡 */}
      {!loading && !error && rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((row, i) => {
            const near = i > 0 && isNear(rows[i - 1], row);
            return (
              <li key={row.id} className="card-dark p-4">
                <div className="flex flex-col gap-4 md:flex-row">
                  {/* 證明截圖（signed URL，1 小時） */}
                  <button
                    type="button"
                    onClick={() =>
                      setLightbox({ url: row.proof_url, label: `${row.display_name ?? "會員"} 的完賽證明` })
                    }
                    className="slab group relative min-h-11 w-full flex-none overflow-hidden border border-white/15 bg-black/40 md:w-32"
                    aria-label="查看完賽證明截圖大圖"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={row.proof_url}
                      alt={`${row.display_name ?? "會員"}的完賽證明截圖`}
                      loading="lazy"
                      className="h-24 w-full object-contain md:h-20"
                    />
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="slab inline-flex items-center gap-1 border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/75">
                        {row.division_label}
                      </span>
                      {near && (
                        <span
                          className="slab inline-flex items-center border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300"
                          title="與上一筆同類別同日、完賽時間相近"
                        >
                          相近
                        </span>
                      )}
                    </div>

                    <p className="mt-2 min-w-0 break-words text-sm font-bold text-white/90">
                      {row.team_name ? row.team_name : row.display_name ?? "會員"}
                    </p>
                    {(row.team_name || row.teammates.length > 0) && (
                      <p className="mt-0.5 min-w-0 break-words text-xs text-white/55">
                        提交者：{row.display_name ?? "會員"}
                        {row.teammates.length > 0 ? ` · 隊友：${row.teammates.join("・")}` : ""}
                      </p>
                    )}

                    <dl className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-white/55">
                      <div className="min-w-0">
                        <dt className="inline text-white/40">時間 </dt>
                        <dd className="stat-figure tnum inline font-bold text-white">
                          {row.finish_label}
                        </dd>
                      </div>
                      <span className="min-w-0 truncate" title={`${row.race_name} · ${row.race_date}`}>
                        {row.race_name} · {formatDate(row.race_date)}
                      </span>
                    </dl>

                    {row.note && (
                      <p className="mt-1.5 min-w-0 break-words text-xs text-white/50">
                        備註：{row.note}
                      </p>
                    )}
                    {row.status === "rejected" && row.admin_note && (
                      <p className="mt-1.5 min-w-0 break-words text-xs text-red-300/80">
                        拒絕原因：{row.admin_note}
                      </p>
                    )}
                  </div>

                  {/* 動作（只對 pending） */}
                  {row.status === "pending" && (
                    <div className="flex flex-none items-center gap-2 md:flex-col md:items-stretch">
                      <button
                        type="button"
                        onClick={() => void approve(row)}
                        disabled={busyId === row.id}
                        className="btn-base btn-cobalt min-h-11 flex-1 px-4 py-2 text-sm disabled:opacity-60"
                      >
                        {busyId === row.id ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Check size={15} />
                        )}
                        核可
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejectTarget(row);
                          setRejectNote("");
                          setRejectError(null);
                        }}
                        disabled={busyId === row.id}
                        className="btn-base btn-ghost min-h-11 flex-1 px-4 py-2 text-sm disabled:opacity-60"
                      >
                        <X size={15} /> 拒絕
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
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
              <button type="button" onClick={() => setLightbox(null)} className="btn-base btn-cobalt">
                關閉
              </button>
            </>
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.url}
            alt="完賽證明大圖"
            className="max-h-[70vh] w-full bg-white object-contain"
          />
        </AdminModal>
      )}

      {/* 拒絕原因（§5-11 凍結文案欄位名） */}
      {rejectTarget && (
        <AdminModal
          title="拒絕這筆完賽成績"
          description="原因會顯示給會員，請寫清楚問題所在（例如截圖看不到完賽時間）。"
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
            <label className="label" htmlFor="result-reject-note">
              拒絕原因（必填）
            </label>
            <textarea
              id="result-reject-note"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={3}
              maxLength={200}
              placeholder="例：截圖看不到完賽時間，請補一張含時間的畫面。"
              className="field w-full resize-y"
            />
          </div>
        </AdminModal>
      )}
    </div>
  );
}
