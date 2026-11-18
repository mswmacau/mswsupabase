"use client";

/**
 * src/app/admin/events/RacesAdmin.tsx — 賽事列表（?tab=races 的預設視圖）
 *
 * Owner：方砚（frontend-engineer）
 *
 * 【一次只做一件事】
 * 這支只負責「列出賽事 + 四個即時操作（上架／下架、複製）+ 掛載三個子視圖」。
 * 三段式表單在 `RaceForm`、名單與彙總在 `RaceRoster`，各自獨立檔案。
 *
 * 【為什麼用 id 而不是物件存「正在編輯的那場」】
 * 組別增刪、名單審核後會 `router.refresh()`，伺服器元件重算後會傳新的 `races`。
 * 若把 `AdminRace` 物件存進 state，彈窗會停在舊資料（例如剛剛加了組別卻看不到）。
 * 存 id、每次 render 從 props 推導，refresh 後彈窗自動同步。
 *
 * 【手機優先】
 * 每張卡手機是「列式」：資訊在上、按鈕在下並自動換行（w-full），
 * 按鈕一律 min-h-11（44px）。桌面改為橫式（lg:flex-row），按鈕靠右。
 * 全程沒有表格，不會產生橫向滾動。
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowRight,
  Copy,
  Loader2,
  Pencil,
  Plus,
  Rocket,
  Users,
} from "lucide-react";
import { patchJson, postJson } from "@/lib/fetch-json";
import { RaceForm } from "./RaceForm";
import { RaceRoster } from "./RaceRoster";
import {
  RACE_STATUS_META,
  deadlineLabel,
  raceDateRange,
  raceFeeLabel,
  toRaceStatus,
  type AdminRace,
  type RacesAdminProps,
} from "./race-types";

/** 次要操作的統一外觀（44px 高、細邊框） */
const ACT_CLS =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-white/20 px-3 text-xs font-semibold text-white/80 transition hover:border-white/40 hover:bg-white/5 disabled:opacity-50";

export function RacesAdmin({ races, summaryAvailable }: RacesAdminProps) {
  const router = useRouter();

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rosterId, setRosterId] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<AdminRace | null>(null);
  /**
   * 已下架預設收起（與「一般活動」分頁的 EventManager:278-286 同一個約定）。
   * 賽事不能硬刪除（報名與付款紀錄要留），測試賽事下架後會一直留在資料裡，
   * 不收起的話列表每次都在看歷史資料。
   */
  const [showArchived, setShowArchived] = useState(false);

  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const archivedCount = races.filter(
    (r) => toRaceStatus(r.status) === "archived"
  ).length;
  const visible = showArchived
    ? races
    : races.filter((r) => toRaceStatus(r.status) !== "archived");

  /* 從 props 推導，refresh 後自動拿到最新資料（見檔頭說明） */
  const editingRace = races.find((r) => r.id === editingId) ?? null;
  const rosterRace = races.find((r) => r.id === rosterId) ?? null;

  function done(message: string) {
    setSuccess(message);
    setError(null);
    router.refresh();
  }

  return (
    <div className="min-w-0 space-y-4">
      {/* 頂部：主動作 + 成功／錯誤訊息 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-act="new-race"
            onClick={() => {
              setCreating(true);
              setSuccess(null);
              setError(null);
            }}
            className="btn-base btn-vital text-sm"
          >
            <Plus size={16} aria-hidden /> 新增賽事
          </button>
          <label
            htmlFor="races-show-archived"
            className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-white/70"
          >
            <input
              id="races-show-archived"
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-vital)]"
            />
            顯示已下架（{archivedCount}）
          </label>
        </div>
        {success && (
          <div
            role="status"
            className="min-w-0 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-200 [overflow-wrap:anywhere]"
          >
            {success}
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 [overflow-wrap:anywhere]"
        >
          {error}
        </div>
      )}

      {/* 前台出口提示：與一般活動同一套說法，讓他知道去哪裡看結果 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cobalt/40 bg-cobalt/10 px-4 py-3 text-sm text-white/85">
        <span className="min-w-0">
          只有「報名中」及之後的狀態會出現在前台賽事頁；草稿與已下架前台看不到。
        </span>
        <Link
          href="/races"
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 border border-white/25 px-3 text-xs font-semibold text-white transition hover:border-white/50 hover:bg-white/10"
        >
          查看賽事頁 <ArrowRight size={14} aria-hidden />
        </Link>
      </div>

      {/* 彙總檢視不存在：顯示可執行的下一步，但不擋任何操作 */}
      {!summaryAvailable && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          賽事彙總數字暫時讀不到（`race_summary` 檢視未建立）。請在 Supabase SQL
          Editor 執行 `supabase/migration-races.sql`。列表與編輯功能不受影響。
        </div>
      )}

      {/* 列表 */}
      {races.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 px-6 py-14 text-center">
          <p className="text-sm font-semibold text-white/85">還沒有任何賽事。</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/60">
            第一歩：按上方「新增賽事」建立第一場（例如「廣州 HYROX 2026」）。
            存檔後再按該場的「編輯」，就能逐日加入組別、設定費用與相簿。
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 px-6 py-10 text-center text-sm text-white/65">
          目前沒有進行中的賽事（{archivedCount} 場已下架）。勾選上方「顯示已下架」
          可以找回舊賽事，或按「新增賽事」建立新的一場。
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((race) => (
            <RaceCard
              key={race.id}
              race={race}
              summaryAvailable={summaryAvailable}
              onEdit={() => {
                setEditingId(race.id);
                setSuccess(null);
                setError(null);
              }}
              onRoster={() => {
                setRosterId(race.id);
                setSuccess(null);
                setError(null);
              }}
              onDuplicate={() => {
                setDuplicating(race);
                setSuccess(null);
                setError(null);
              }}
              onChanged={done}
              onError={(message) => {
                setError(message);
                setSuccess(null);
              }}
            />
          ))}
        </div>
      )}

      {/* 子視圖 */}
      {creating && (
        <RaceForm
          mode="create"
          race={null}
          onClose={() => setCreating(false)}
          onSaved={(message) => {
            setCreating(false);
            done(message);
          }}
        />
      )}

      {editingRace && (
        <RaceForm
          mode="edit"
          race={editingRace}
          onClose={() => setEditingId(null)}
          onSaved={(message) => {
            setEditingId(null);
            done(message);
          }}
        />
      )}

      {rosterRace && (
        <RaceRoster
          race={rosterRace}
          onClose={() => setRosterId(null)}
          onReviewed={(message) => {
            setSuccess(message);
            setError(null);
            router.refresh();
          }}
        />
      )}

      {duplicating && (
        <DuplicateDialog
          race={duplicating}
          onClose={() => setDuplicating(null)}
          onDone={(message) => {
            setDuplicating(null);
            done(message);
          }}
        />
      )}
    </div>
  );
}

/* =============================================================
 * 單場賽事卡
 * ============================================================= */

function RaceCard({
  race,
  summaryAvailable,
  onEdit,
  onRoster,
  onDuplicate,
  onChanged,
  onError,
}: {
  race: AdminRace;
  summaryAvailable: boolean;
  onEdit: () => void;
  onRoster: () => void;
  onDuplicate: () => void;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const status = toRaceStatus(race.status);
  const badge = RACE_STATUS_META[status];
  const isArchived = status === "archived";
  /**
   * 草稿與已下架 → 「上架」（變成 open，前台開始收報名）；
   * 報名中／已截止／相片模式 → 「下架」（archived，前台看不到、資料保留）。
   *
   * 草稿不該顯示「下架」——草稿本來就不在前台，講「下架」只會讓人以為自己做錯事。
   */
  const willPublish = isArchived || status === "draft";
  const showCount = summaryAvailable && race.summary !== null;

  async function toggleStatus() {
    const next = willPublish ? "open" : "archived";
    if (
      next === "archived" &&
      !window.confirm(
        "下架後前台看不到這場賽事，報名與付款紀錄會保留。確定下架？"
      )
    ) {
      return;
    }

    setPending(true);
    try {
      await patchJson<{ ok: true }>(`/api/admin/races/${race.id}`, {
        status: next,
      });
      onChanged(
        next === "archived"
          ? `已下架「${race.title}」。`
          : `已上架「${race.title}」，前台現在開始收報名。`
      );
    } catch (e) {
      // 伺服器回的是可直接顯示的中文（_shared.ts 統一出口），不要自己改寫
      onError(e instanceof Error ? e.message : "操作失敗，請稍後再試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <article
      data-race-card
      data-race-id={race.id}
      data-race-status={status}
      className="card-dark flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:gap-5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            data-race-title
            className="min-w-0 break-words font-semibold line-clamp-2 lg:line-clamp-none"
          >
            {race.title}
          </span>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}
          >
            {badge.label}
          </span>
          {race.promo_on_home && (
            <span className="shrink-0 rounded-full border border-cobalt/40 bg-cobalt/10 px-2.5 py-0.5 text-xs font-semibold text-blue-200">
              主頁顯示中
            </span>
          )}
        </div>

        <div className="mt-1 min-w-0 break-words text-xs text-white/70">
          {raceDateRange(race.event_date, race.end_date)}
          {race.location ? ` · ${race.location}` : ""}
          {` · ${race.categories.length} 個組別`}
          {race.fee_cents ? ` · ${raceFeeLabel(race.fee_cents)}` : ""}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55">
          <span className="inline-flex items-center gap-1">
            <Users size={12} aria-hidden className="shrink-0" />
            {showCount ? `已報 ${race.summary?.registrations ?? 0} 人` : "已報 —"}
          </span>
          <span>截止：{deadlineLabel(race.registration_deadline)}</span>
        </div>
      </div>

      <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:shrink-0">
        <button
          type="button"
          data-act="roster"
          onClick={onRoster}
          className={`${ACT_CLS} border-cobalt/40 bg-cobalt/10 text-blue-200 hover:bg-cobalt/20`}
        >
          <Users size={14} aria-hidden /> 看名單
        </button>
        <button type="button" data-act="edit" onClick={onEdit} className={ACT_CLS}>
          <Pencil size={14} aria-hidden /> 編輯
        </button>
        <button
          type="button"
          data-act="duplicate"
          onClick={onDuplicate}
          className={ACT_CLS}
        >
          <Copy size={14} aria-hidden /> 複製
        </button>
        <button
          type="button"
          data-act="toggle"
          onClick={() => void toggleStatus()}
          disabled={pending}
          className={
            willPublish
              ? `${ACT_CLS} border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10`
              : `${ACT_CLS} border-red-500/40 text-red-300 hover:bg-red-500/10`
          }
        >
          {pending ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : willPublish ? (
            <Rocket size={14} aria-hidden />
          ) : (
            <Archive size={14} aria-hidden />
          )}
          {willPublish ? "上架" : "下架"}
        </button>
      </div>
    </article>
  );
}

/* =============================================================
 * 複製對話框：只問一個日期
 * ============================================================= */

function DuplicateDialog({
  race,
  onClose,
  onDone,
}: {
  race: AdminRace;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [startDate, setStartDate] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!startDate) {
      setError("請選擇新的開始日。");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await postJson<{ ok: true }>(`/api/admin/races/${race.id}/duplicate`, {
        start_date: startDate,
      });
      onDone(
        `已建立草稿「${race.title}（複製）」，請檢查日期與組別，確認後再把狀態改成「報名中」。`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "複製失敗，請稍後再試。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dup-title"
      className="fixed inset-0 z-[70] overflow-y-auto bg-ink/80 backdrop-blur-sm"
    >
      <div className="mx-auto my-10 w-full max-w-md px-4">
        <div className="card-dark p-5 md:p-6">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h3 id="dup-title" className="text-lg font-bold">
              複製賽事
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 shrink-0 rounded-lg border border-white/20 px-3 text-sm text-white/70 transition hover:border-white/40"
            >
              關閉
            </button>
          </div>

          <p className="text-sm leading-relaxed text-white/70">
            會複製「{race.title}」的內容與全部組別，日期依新開始日自動位移。
          </p>

          <div className="mt-4">
            <label className="label" htmlFor="dup-start">
              新的開始日 *
            </label>
            <input
              id="dup-start"
              type="date"
              className="field"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <p className="mt-2 text-xs leading-relaxed text-white/50">
            新賽事一律建成草稿；主頁曝光與報名截止時間會清空（舊截止時間多半已過，
            照抄會讓新賽事一建立就截止）。
          </p>

          {error && (
            <p role="alert" className="mt-3 text-xs text-red-300">
              {error}
            </p>
          )}

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              data-act="duplicate-confirm"
              onClick={() => void submit()}
              disabled={pending}
              className="btn-base btn-vital text-sm"
            >
              {pending ? (
                <>
                  <Loader2 size={16} className="animate-spin" aria-hidden /> 建立中…
                </>
              ) : (
                "建立草稿"
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-base btn-ghost text-sm"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
