"use client";

/**
 * src/app/admin/events/RaceRoster.tsx — 賽事名單與彙總（點「看名單」開啟）
 *
 * Owner：方砚（frontend-engineer）
 *
 * 【這頁只讀一支端點】
 * GET /api/admin/races/[id]/registrations?page=&size=&status=
 * 這是全站**唯一**會回姓名的賽事端點（已授權管理員限定）。彙總數字（去重人數、
 * 人次、巴士座位、住宿人／晚）也在同一個回應裡，所以名單頁只打一次網路。
 *
 * 【為什麼彙總數字用 API 而不是 props】
 * 審核完（確認／拒絕）人數會變，props 是進頁前的快照。名單頁重新抓一次，
 * 數字永遠跟名單一致；props 只用來補 API 沒有的東西（需巴士人數、日期×組別明細）。
 *
 * 【付款截圖】
 * 後端用私有桶 run-screenshots 簽 1 小時有效的 signed URL（proof_url）。
 * 前端**不生任何 URL**：proof_url 有值才顯示「看截圖」，
 * 沒值就當「未上載／連結失效」處理。
 *
 * 【手機】彙總是 2×2 格、日期×組別是「每天一張卡」、名單每筆一張卡；
 * 全程沒有 <table>，不會產生橫向滾動。
 */

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Phone, X } from "lucide-react";
import { patchJson, requestJson } from "@/lib/fetch-json";
import {
  RACE_STATUS_META,
  deadlineLabel,
  raceDateRange,
  raceDayLabel,
  toRaceStatus,
  type RaceRosterProps,
} from "./race-types";

/** 每頁筆數（手機一頁 20 筆已經要滑很久；API 上限 200） */
const PAGE_SIZE = 20;

interface RosterEntry {
  id: string;
  category_id: string;
  category_name: string | null;
  day: string | null;
  teammate_names: string | null;
}

interface RosterRegistration {
  id: string;
  full_name: string;
  phone: string;
  gender: "male" | "female" | null;
  needs_bus: boolean;
  bus_seats: number;
  needs_lodging: boolean;
  lodging_people: number;
  lodging_nights: number;
  payment_status: string;
  status: string;
  member_note: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  /** 私有桶簽名連結（1 小時）；null = 沒有截圖或簽名失敗 */
  proof_url: string | null;
  entries: RosterEntry[];
}

interface RosterResponse {
  ok: true;
  event: { id: string; title: string; start_date: string; end_date: string | null };
  page: number;
  size: number;
  total: number;
  summary: {
    registrations: number;
    entries: number;
    bus_seats: number;
    lodging_people: number;
    lodging_nights: number;
    by_status: Record<string, number>;
    by_payment: Record<string, number>;
  };
  summary_source: "view" | "computed";
  registrations: RosterRegistration[];
}

const REG_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  submitted: { label: "待確認", cls: "border-amber-500/40 bg-amber-500/10 text-amber-200" },
  confirmed: { label: "已確認", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  needs_info: { label: "需補資料", cls: "border-cobalt/40 bg-cobalt/10 text-blue-200" },
  cancelled: { label: "已拒絕／取消", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  not_required: "免付款",
  pending: "待付款",
  approved: "已付款",
  rejected: "付款有問題",
};

const GENDER_LABEL: Record<string, string> = { male: "男", female: "女" };

export function RaceRoster({ race, onClose, onReviewed }: RaceRosterProps) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** 匯出選項是否展開（手機沒有 hover，所以一律「點一下才展開」） */
  const [exportOpen, setExportOpen] = useState(false);

  /**
   * 取數。沿用 EventManager 的「cancelled 旗標」模式：卸載或換頁後
   * 不再 setState（requestJson 沒有 signal 參數，用旗標擋掉過期回應）。
   */
  const load = useCallback(
    async (targetPage: number, isActive: () => boolean = () => true) => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await requestJson<RosterResponse>(
          `/api/admin/races/${race.id}/registrations?page=${targetPage}&size=${PAGE_SIZE}`,
          { method: "GET" }
        );
        if (!isActive()) return;
        setData(res);
      } catch (e) {
        if (!isActive()) return;
        setData(null);
        setLoadError(
          e instanceof Error ? e.message : "讀取名單失敗，請稍後再試。"
        );
      } finally {
        if (isActive()) setLoading(false);
      }
    },
    [race.id]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load(page, () => !cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [load, page]);

  /**
   * 審核一筆：PATCH /api/admin/races/registrations/[id]
   * status ∈ submitted / confirmed / needs_info / cancelled；admin_note ≤1000 字。
   */
  async function review(
    row: RosterRegistration,
    status: "confirmed" | "needs_info" | "cancelled",
    note?: string
  ) {
    setReviewing(row.id);
    setActionError(null);
    setMessage(null);
    try {
      await patchJson<{ ok: true }>(`/api/admin/races/registrations/${row.id}`, {
        status,
        ...(note !== undefined && note.trim() !== ""
          ? { admin_note: note.trim() }
          : {}),
      });

      const text =
        status === "confirmed"
          ? `已確認「${row.full_name}」的報名。`
          : status === "needs_info"
            ? `已標記「${row.full_name}」需要補資料。`
            : `已拒絕「${row.full_name}」的報名。`;

      setMessage(text);
      onReviewed(text);
      // 重新抓這一頁：人數、狀態統計都會變
      await load(page);
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "審核失敗，請稍後再試。"
      );
    } finally {
      setReviewing(null);
    }
  }

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const summary = data?.summary ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="roster-title"
      className="fixed inset-0 z-[70] overflow-y-auto bg-ink/85 backdrop-blur-sm"
    >
      <div className="mx-auto my-6 w-full max-w-4xl px-4 md:my-10">
        <div data-roster className="card-dark p-5 md:p-7">
          {/* 標題 */}
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 id="roster-title" className="text-lg font-bold break-words">
                {race.title} · 名單
              </h3>
              <p className="mt-1 text-xs text-white/55">
                {raceDateRange(race.event_date, race.end_date)}
                {race.location ? ` · ${race.location}` : ""} · 狀態：
                {RACE_STATUS_META[toRaceStatus(race.status)].label} · 截止：
                {deadlineLabel(race.registration_deadline)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-white/20 px-3 text-sm text-white/70 transition hover:border-white/40"
            >
              <X size={15} aria-hidden /> 關閉
            </button>
          </div>

          {message && (
            <p
              role="status"
              className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200"
            >
              {message}
            </p>
          )}
          {actionError && (
            <p
              role="alert"
              className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200 [overflow-wrap:anywhere]"
            >
              {actionError}
            </p>
          )}

          {/* ── 上半：彙總 2×2 ─────────────────────────────── */}
          <section aria-labelledby="roster-sum" className="mb-6">
            <h4
              id="roster-sum"
              className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/55"
            >
              彙總
            </h4>

            {loading && !data ? (
              <p className="flex items-center gap-2 text-sm text-white/60">
                <Loader2 size={15} className="animate-spin" aria-hidden />{" "}
                讀取彙總中…
              </p>
            ) : loadError ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                <span className="min-w-0 [overflow-wrap:anywhere]">{loadError}</span>
                <button
                  type="button"
                  onClick={() => void load(page)}
                  className="inline-flex min-h-11 items-center rounded-lg border border-red-500/50 px-3 text-xs font-semibold text-red-200 transition hover:bg-red-500/10"
                >
                  重試
                </button>
              </div>
            ) : summary ? (
              <div className="grid grid-cols-2 gap-2.5">
                <SummaryCell
                  label="報名人數（去重）"
                  value={String(summary.registrations)}
                  unit="人"
                />
                <SummaryCell
                  label="總人次"
                  value={String(summary.entries)}
                  unit="人次"
                />
                <SummaryCell
                  label="巴士"
                  value={String(summary.bus_seats)}
                  unit="座位"
                  hint={
                    race.summary
                      ? `需搭車 ${race.summary.bus_people} 人`
                      : undefined
                  }
                />
                <SummaryCell
                  label="住宿"
                  value={`${summary.lodging_people} 人 · ${summary.lodging_nights} 晚`}
                  unit=""
                />
              </div>
            ) : null}

            {data?.summary_source === "computed" && (
              <p className="mt-2 text-xs text-amber-200/80">
                彙總數字為即時計算（`race_summary` 檢視未建立），超過 5000 筆時可能低估。
              </p>
            )}
          </section>

          {/* ── 日期 × 組別（每天一張卡，不做橫向表格）─────── */}
          <section aria-labelledby="roster-byday" className="mb-6">
            <h4
              id="roster-byday"
              className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/55"
            >
              各日各組別人數
            </h4>

            {race.categoryCounts.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/15 px-4 py-3 text-xs leading-relaxed text-white/55">
                暫時讀不到分組數字（`race_category_summary` 檢視未建立，或這場還沒有組別）。
                請先到「編輯」加入組別。
              </p>
            ) : (
              <div className="space-y-2.5">
                {groupByDay(race.categoryCounts).map((group) => (
                  <div
                    key={group.day}
                    className="rounded-xl border border-ink-line bg-ink-soft p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-white/70">
                      <span>{raceDayLabel(group.day)}</span>
                      <span className="text-white/45">
                        {group.rows.length} 組 · {group.entries} 人次
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {group.rows.map((row) => (
                        <li
                          key={row.category_id}
                          className="flex items-baseline justify-between gap-2 text-sm"
                        >
                          <span className="min-w-0 truncate text-white/85">
                            {row.name}
                          </span>
                          <span className="shrink-0 text-xs text-white/55 tabular-nums">
                            {row.registrations} 人 / {row.entries} 人次
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── 下半：名單 ─────────────────────────────────── */}
          <section aria-labelledby="roster-list">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4
                id="roster-list"
                className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55"
              >
                報名名單
              </h4>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-white/45 tabular-nums">
                  共 {total} 筆 · 第 {page} / {totalPages} 頁
                </span>
                {/*
                  匯出：一律「點一下展開」，不做 hover 選單（手機沒有 hover）。
                  純 <a download> 讓瀏覽器自己下載，不用 fetch + blob
                  （iOS Safari 會把 blob 下載吃掉）。
                */}
                <button
                  type="button"
                  data-act="export-toggle"
                  aria-expanded={exportOpen}
                  aria-controls="roster-export"
                  onClick={() => setExportOpen((v) => !v)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-white/20 px-3 text-xs font-semibold text-white/80 transition hover:border-white/40"
                >
                  <Download size={14} aria-hidden /> 匯出 CSV
                </button>
              </div>
            </div>

            {exportOpen && (
              <div id="roster-export" className="mb-3 grid gap-2 sm:grid-cols-3">
                <ExportLink
                  raceId={race.id}
                  type="detail"
                  label="匯出全部名單"
                  hint="每人一列 · 對帳用"
                />
                <ExportLink
                  raceId={race.id}
                  type="logistics"
                  label="匯出交通住宿"
                  hint="巴士與酒店用"
                />
                <ExportLink
                  raceId={race.id}
                  type="summary"
                  label="匯出彙總"
                  hint="日期 × 組別"
                />
              </div>
            )}

            {loading && !data ? (
              <p className="flex items-center gap-2 text-sm text-white/60">
                <Loader2 size={15} className="animate-spin" aria-hidden />{" "}
                讀取名單中…
              </p>
            ) : loadError ? null : data && data.registrations.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center">
                <p className="text-sm font-semibold text-white/80">
                  目前還沒有人報名。
                </p>
                <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-white/55">
                  當賽事狀態是「報名中」且未過截止時間，前台賽事頁就會出現報名入口。
                  有人報名後，這裡會列出姓名、電話、參賽組別、巴士座位、住宿與付款截圖。
                </p>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {(data?.registrations ?? []).map((row) => (
                  <RegistrationCard
                    key={row.id}
                    row={row}
                    pending={reviewing === row.id}
                    onReview={review}
                  />
                ))}
              </ul>
            )}

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  data-act="roster-prev"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex min-h-11 items-center rounded-lg border border-white/20 px-3 text-xs font-semibold text-white/80 transition hover:border-white/40 disabled:opacity-40"
                >
                  上一頁
                </button>
                <button
                  type="button"
                  data-act="roster-next"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex min-h-11 items-center rounded-lg border border-white/20 px-3 text-xs font-semibold text-white/80 transition hover:border-white/40 disabled:opacity-40"
                >
                  下一頁
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* =============================================================
 * 小元件
 * ============================================================= */

function SummaryCell({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit: string;
  hint?: string;
}) {
  return (
    <div
      data-summary-cell
      className="rounded-xl border border-ink-line bg-ink-soft px-3 py-2.5"
    >
      <div className="text-[11px] leading-tight text-white/50">{label}</div>
      <div className="mt-1 text-lg font-black leading-none text-white tabular-nums">
        {value}
        {unit && <span className="ml-1 text-xs font-semibold text-white/55">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-[11px] text-white/45">{hint}</div>}
    </div>
  );
}

/**
 * 匯出下載連結。
 *
 * 用純 <a download> 而不是 fetch + Blob：下載由瀏覽器自己處理（iOS Safari 對
 * Blob 下載支援很差），檔名由伺服器的 Content-Disposition 決定，也不需要
 * 在前端把整份 CSV 塞進記憶體。
 */
function ExportLink({
  raceId,
  type,
  label,
  hint,
}: {
  raceId: string;
  type: "detail" | "logistics" | "summary";
  label: string;
  hint: string;
}) {
  return (
    <a
      href={`/api/admin/races/${raceId}/registrations/export?type=${type}`}
      download
      data-act={`export-${type}`}
      className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-ink-line bg-ink-soft px-3 py-2 text-xs font-semibold text-white/80 transition hover:border-white/40"
    >
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 text-[11px] font-normal text-white/45">CSV · {hint}</span>
    </a>
  );
}

function RegistrationCard({
  row,
  pending,
  onReview,
}: {
  row: RosterRegistration;
  pending: boolean;
  onReview: (
    row: RosterRegistration,
    status: "confirmed" | "needs_info" | "cancelled",
    note?: string
  ) => Promise<void>;
}) {
  const [noteOpen, setNoteOpen] = useState<null | "needs_info" | "cancelled">(
    null
  );
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  const statusMeta =
    REG_STATUS_LABEL[row.status] ?? {
      label: row.status,
      cls: "border-white/25 bg-white/10 text-white/70",
    };

  async function submitNote() {
    if (note.trim() === "") {
      setNoteError(
        noteOpen === "cancelled"
          ? "請寫上拒絕原因，參賽者才看得懂。"
          : "請寫上要補什麼資料，參賽者才看得懂。"
      );
      return;
    }
    setNoteError(null);
    if (noteOpen) await onReview(row, noteOpen, note);
    setNoteOpen(null);
    setNote("");
  }

  return (
    <li
      data-reg-row
      data-reg-id={row.id}
      data-reg-status={row.status}
      className="rounded-xl border border-ink-line bg-ink-soft p-3"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 break-words text-sm font-semibold text-white/90">
          {row.full_name}
        </span>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusMeta.cls}`}
        >
          {statusMeta.label}
        </span>
        <span className="shrink-0 rounded-full border border-white/20 px-2 py-0.5 text-[11px] text-white/65">
          {PAYMENT_STATUS_LABEL[row.payment_status] ?? row.payment_status}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60">
        <a
          href={`tel:${row.phone}`}
          className="inline-flex min-h-11 items-center gap-1 text-white/70 underline-offset-2 hover:underline md:min-h-0"
        >
          <Phone size={12} aria-hidden className="shrink-0" />
          {row.phone}
        </a>
        <span>{row.gender ? GENDER_LABEL[row.gender] ?? row.gender : "性別未填"}</span>
        <span>
          巴士：
          {row.needs_bus ? `${row.bus_seats} 個座位` : "不需要"}
        </span>
        <span>
          住宿：
          {row.needs_lodging
            ? `${row.lodging_people} 人 / ${row.lodging_nights} 晚`
            : "不需要"}
        </span>
      </div>

      <div className="mt-1.5 text-xs text-white/60">
        <span className="text-white/45">參賽項目：</span>
        {row.entries.length === 0 ? (
          <span className="text-white/40">未填</span>
        ) : (
          row.entries.map((entry) => (
            <span key={entry.id} className="mr-2 inline-block">
              {entry.category_name ?? "（組別已刪除）"}
              {entry.day ? (
                <span className="text-white/40">（{raceDayLabel(entry.day)}）</span>
              ) : null}
              {entry.teammate_names ? (
                <span className="text-white/45"> · 隊友：{entry.teammate_names}</span>
              ) : null}
            </span>
          ))
        )}
      </div>

      {row.member_note && (
        <p className="mt-1.5 text-xs leading-relaxed text-white/55 [overflow-wrap:anywhere]">
          <span className="text-white/40">參賽者備註：</span>
          {row.member_note}
        </p>
      )}
      {row.admin_note && (
        <p className="mt-1.5 text-xs leading-relaxed text-amber-200/80 [overflow-wrap:anywhere]">
          <span className="text-amber-200/50">你的備註：</span>
          {row.admin_note}
        </p>
      )}

      {/* 付款截圖：有 signed URL 才給連結，前端不生任何 URL */}
      <div className="mt-2">
        {row.proof_url ? (
          <a
            href={row.proof_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-lg border border-cobalt/40 bg-cobalt/10 px-3 text-xs font-semibold text-blue-200 transition hover:bg-cobalt/20 md:min-h-0 md:py-1.5"
          >
            看付款截圖
          </a>
        ) : row.payment_status === "not_required" ? (
          <span className="text-xs text-white/40">免付款</span>
        ) : (
          <span className="text-xs text-white/45">付款截圖：未上載或連結失效</span>
        )}
      </div>

      {/* 審核操作 */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-act="confirm"
          disabled={pending || row.status === "confirmed"}
          onClick={() => void onReview(row, "confirmed")}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-emerald-500/40 px-3 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-40"
        >
          {pending ? <Loader2 size={13} className="animate-spin" aria-hidden /> : null}
          {row.status === "confirmed" ? "已確認" : "確認"}
        </button>
        <button
          type="button"
          data-act="needs-info"
          disabled={pending}
          onClick={() => {
            setNoteOpen(noteOpen === "needs_info" ? null : "needs_info");
            setNoteError(null);
            setNote(row.admin_note ?? "");
          }}
          className="inline-flex min-h-11 items-center rounded-lg border border-white/20 px-3 text-xs font-semibold text-white/80 transition hover:border-white/40 disabled:opacity-40"
        >
          要求補資料
        </button>
        <button
          type="button"
          data-act="reject"
          disabled={pending}
          onClick={() => {
            setNoteOpen(noteOpen === "cancelled" ? null : "cancelled");
            setNoteError(null);
            setNote(row.admin_note ?? "");
          }}
          className="inline-flex min-h-11 items-center rounded-lg border border-red-500/40 px-3 text-xs font-semibold text-red-300 transition hover:bg-red-500/10 disabled:opacity-40"
        >
          拒絕
        </button>
      </div>

      {noteOpen && (
        <div className="mt-2 rounded-lg border border-ink-line bg-ink p-3">
          <label className="label" htmlFor={`note-${row.id}`}>
            {noteOpen === "cancelled"
              ? "拒絕原因（會寫進稽核紀錄）*"
              : "要補什麼資料（會寫進稽核紀錄）*"}
          </label>
          <textarea
            id={`note-${row.id}`}
            className="field min-h-20 resize-y"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              noteOpen === "cancelled"
                ? "例如：未收到付款截圖，已過截止時間"
                : "例如：請補上付款截圖，以及雙人組隊友姓名"
            }
          />
          {noteError && <p className="mt-1 text-xs text-red-300">{noteError}</p>}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void submitNote()}
              disabled={pending}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-white/25 px-3 text-xs font-semibold text-white transition hover:border-white/45 disabled:opacity-40"
            >
              {pending ? <Loader2 size={13} className="animate-spin" aria-hidden /> : null}
              送出
            </button>
            <button
              type="button"
              onClick={() => {
                setNoteOpen(null);
                setNote("");
                setNoteError(null);
              }}
              className="inline-flex min-h-11 items-center rounded-lg border border-white/20 px-3 text-xs font-semibold text-white/70 transition hover:border-white/40"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** 依日期分組並加總（日期×組別明細來自 race_category_summary 檢視） */
function groupByDay(
  rows: RaceRosterProps["race"]["categoryCounts"]
): { day: string; rows: typeof rows; entries: number }[] {
  const map = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = map.get(row.day) ?? [];
    list.push(row);
    map.set(row.day, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, list]) => ({
      day,
      rows: list,
      entries: list.reduce((sum, r) => sum + r.entries, 0),
    }));
}
