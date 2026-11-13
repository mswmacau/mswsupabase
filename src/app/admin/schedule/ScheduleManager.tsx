"use client";

/**
 * src/app/admin/schedule/ScheduleManager.tsx — 月班表管理主容器（client）
 *
 * 職責：
 *   · 月份游標（左右切換）與該月的發布狀態
 *   · 場次列表（按日期分組）＋逐場新增／編輯／刪除
 *   · 發布／取消發布、複製上月
 *
 * 資料流：全部走 /api/admin/training/*（server route 已做 admin 授權），
 * 每次寫入成功後同時重抓「月份」與「場次」，避免徽章與列表對不上。
 *
 * 三個必處理的邊界：
 *   · loading —— skeleton + 超過 3 秒的文案（不是只有轉圈）
 *   · empty   —— 空月份有明確引導；課程為空時表單禁用儲存
 *   · error   —— 可讀訊息 + 重試；SCHEMA_OUTDATED 另外走 migration 引導卡片
 *
 * 生命週期與 render 純度：
 *   · 初始月份與「現在時間」由 page.tsx（server component）算好傳進來，
 *     不在 render 或 effect 裡讀 Date.now() —— 否則 SSR 與 hydration 的
 *     文字會不一致（React #418）。
 *   · 每個 fetch 都帶 AbortController，切換月份或卸載時 abort，
 *     並用 `alive` 旗標避免 abort 之後還 setState。
 *   · loading 狀態由「已載入的 key 是否等於目前月份」推導，不在 effect
 *     同步 setState（eslint react-hooks/set-state-in-effect）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarPlus, Database, Loader2, RotateCw } from "lucide-react";
import { AdminError, AdminNotice, ConfirmDialog } from "@/components/admin/ui";
import {
  copyTrainingMonth,
  deleteTrainingSession,
  fetchTrainingClasses,
  fetchTrainingMonths,
  fetchTrainingSessions,
  isAbortError,
  postTrainingMonth,
  toCode,
  toMessage,
  type ScheduleSession,
  type TrainingClass,
  type TrainingMonthInfo,
  type YearMonth,
} from "./api";
import { dateGroupLabel, macauMonthDay, pad2, shiftMonth, timeRange } from "./format";
import { LegendEditor } from "./LegendEditor";
import { MonthBar } from "./MonthBar";
import { SessionFormDialog } from "./SessionFormDialog";
import { SessionList } from "./SessionList";

type PendingAction = "publish" | "unpublish" | "copy" | null;

type AsyncError = { message: string; code?: string };
type KeyedSessions = { key: string; sessions: ScheduleSession[] };
type KeyedError = { key: string; message: string; code?: string };

export function ScheduleManager({
  initialMonth,
  initialNowMs,
}: {
  initialMonth: YearMonth;
  initialNowMs: number;
}) {
  const [cursor, setCursor] = useState<YearMonth>(initialMonth);
  const [nowMs, setNowMs] = useState<number>(initialNowMs);

  const [months, setMonths] = useState<TrainingMonthInfo[] | null>(null);
  const [monthsError, setMonthsError] = useState<AsyncError | null>(null);
  const [monthsToken, setMonthsToken] = useState(0);

  const [sessionsData, setSessionsData] = useState<KeyedSessions | null>(null);
  const [sessionsErrorData, setSessionsErrorData] = useState<KeyedError | null>(null);
  const [sessionsToken, setSessionsToken] = useState(0);
  const [slowKey, setSlowKey] = useState<string | null>(null);

  const [classes, setClasses] = useState<TrainingClass[]>([]);
  const [classesError, setClassesError] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingAction>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; session: ScheduleSession } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleSession | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [unpublishOpen, setUnpublishOpen] = useState(false);

  const monthKey = useMemo(
    () => `${cursor.year}-${pad2(cursor.month)}`,
    [cursor.year, cursor.month]
  );

  /* 場次與錯誤都綁在「哪一個月份」上：換月後舊資料自然失效，
   * 不需要在 effect 裡同步清空 state。 */
  const sessions = sessionsData?.key === monthKey ? sessionsData.sessions : null;
  const sessionsError =
    sessionsErrorData?.key === monthKey ? sessionsErrorData : null;
  const sessionsLoading = sessions === null && sessionsError === null;
  const slowLoading = sessionsLoading && slowKey === monthKey;

  /* ---------- 課程清單（只抓一次，供表單使用） ---------- */
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    fetchTrainingClasses(controller.signal)
      .then((res) => {
        if (!alive) return;
        setClasses(res.classes);
        setClassesError(null);
      })
      .catch((err: unknown) => {
        if (!alive || isAbortError(err)) return;
        setClassesError(toMessage(err, "課程清單載入失敗，暫時無法新增場次。"));
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  /* ---------- 月份清單（發布狀態來源） ---------- */
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    fetchTrainingMonths(controller.signal)
      .then((res) => {
        if (!alive) return;
        setMonths(res.months);
        setMonthsError(null);
      })
      .catch((err: unknown) => {
        if (!alive || isAbortError(err)) return;
        setMonthsError({ message: toMessage(err), code: toCode(err) });
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [monthsToken]);

  /* ---------- 該月場次 ---------- */
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const key = monthKey;

    fetchTrainingSessions(cursor.year, cursor.month, controller.signal)
      .then((res) => {
        if (!alive) return;
        setSessionsData({ key, sessions: res.sessions });
        setSessionsErrorData(null);
      })
      .catch((err: unknown) => {
        if (!alive || isAbortError(err)) return;
        setSessionsData(null);
        setSessionsErrorData({ key, message: toMessage(err), code: toCode(err) });
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [cursor, monthKey, sessionsToken]);

  /* ---------- 超過 3 秒換文案（setState 在 timer 回呼裡，不在 effect 同步段） ---------- */
  useEffect(() => {
    if (!sessionsLoading) return;
    const timer = setTimeout(() => setSlowKey(monthKey), 3000);
    return () => clearTimeout(timer);
  }, [sessionsLoading, monthKey, sessionsToken]);

  const refreshMonths = useCallback(() => setMonthsToken((n) => n + 1), []);
  const refreshSessions = useCallback(() => setSessionsToken((n) => n + 1), []);
  const refreshAll = useCallback(() => {
    refreshMonths();
    refreshSessions();
    setNowMs(Date.now());
  }, [refreshMonths, refreshSessions]);

  /* ---------- 動作 ---------- */
  async function handlePublish(action: "publish" | "unpublish") {
    if (pending) return;

    setPending(action);
    setActionError(null);
    setNotice(null);

    try {
      const res = await postTrainingMonth({
        action,
        year: cursor.year,
        month: cursor.month,
      });

      if (action === "unpublish") {
        setNotice(
          `已取消發布 ${cursor.year} 年 ${cursor.month} 月班表，前台不再顯示本月。`
        );
      } else {
        // server 的 message 帶原始 ISO 時間（2026-11-01T00:00:00+08:00），對客戶不友善，
        // 這裡自己組；「已排定」要講清楚 ≠ 現在就看得到。
        const effectiveMs = Date.parse(res.effective_at);
        const scheduled = Number.isFinite(effectiveMs) && effectiveMs > Date.now();
        setNotice(
          `已發布 ${cursor.year} 年 ${cursor.month} 月班表，${macauMonthDay(
            res.effective_at
          )} 生效。${scheduled ? "時間到會自動上架，前台目前還看不到。" : "前台已看得到本月班表。"}`
        );
      }

      setNowMs(Date.now());
      refreshMonths();
    } catch (err) {
      setActionError(toMessage(err));
    } finally {
      setPending(null);
    }
  }

  async function handleCopy() {
    if (pending) return;

    const from = shiftMonth(cursor, -1);
    const fromInfo = months?.find((m) => m.year === from.year && m.month === from.month);

    if (fromInfo && fromInfo.sessions_count === 0) {
      setNotice(null);
      setActionError(
        `${from.year} 年 ${from.month} 月沒有場次可複製。可以先切到該月建立，或在本月逐場手動新增。`
      );
      return;
    }

    setPending("copy");
    setActionError(null);
    setNotice(null);

    try {
      const res = await copyTrainingMonth(from, cursor);
      const total = res.created + res.skipped + res.conflicts;
      // 三個數字一定要全講：只看「新增 0 場」會讓客戶以為壞了
      const counts = `新增 ${res.created} 場；${res.skipped} 場因目標月沒有該日期而略過；${res.conflicts} 場已存在而略過。`;

      setNotice(
        total === 0
          ? `${from.year} 年 ${from.month} 月沒有場次可複製（${counts}）`
          : `已從 ${from.year} 年 ${from.month} 月複製到 ${cursor.year} 年 ${cursor.month} 月：${counts}`
      );

      refreshAll();
    } catch (err) {
      setActionError(toMessage(err));
    } finally {
      setPending(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return;

    setDeleting(true);
    setDeleteError(null);

    try {
      const res = await deleteTrainingSession(deleteTarget.id);
      setDeleteTarget(null);
      setNotice(res.message);
      refreshAll();
    } catch (err) {
      // 409 HAS_CHECKINS：server 訊息已寫明「請改為取消」，原樣顯示給客戶
      setDeleteError(toMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  function handleSaved(message: string, sessionDate: string) {
    setDialog(null);

    const shown = `${cursor.year}-${pad2(cursor.month)}`;
    const saved = sessionDate.slice(0, 7);

    if (saved !== shown) {
      setNotice(
        `${message}（該日期屬於 ${Number(saved.slice(0, 4))} 年 ${Number(
          saved.slice(5, 7)
        )} 月，切到該月份才看得到）`
      );
    } else {
      setNotice(message);
    }

    refreshAll();
  }

  /* ---------- 資料表未建立：不要讓客戶面對一片空白 ---------- */
  const schemaOutdated =
    monthsError?.code === "SCHEMA_OUTDATED" || sessionsError?.code === "SCHEMA_OUTDATED";

  if (schemaOutdated) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold">月班表管理</h2>
        </div>
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-8 text-center">
          <Database size={26} className="mx-auto text-amber-300" />
          <h3 className="mt-3 text-base font-bold text-amber-100">資料表還沒建立</h3>
          <p className="mx-auto mt-2 max-w-md break-words text-sm leading-relaxed text-amber-100/85">
            {monthsError?.message ?? sessionsError?.message ?? ""}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-amber-100/70">
            在 Supabase SQL Editor 執行{" "}
            <code className="break-all font-mono">
              supabase/migration-training-months.sql
            </code>
            ，跑完按下面的「重新檢查」。
          </p>
          <button
            type="button"
            onClick={refreshAll}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 px-4 py-1.5 text-xs font-semibold text-amber-100 transition hover:border-amber-300 hover:text-white"
          >
            <RotateCw size={13} />
            重新檢查
          </button>
        </div>
      </div>
    );
  }

  const monthInfo = months?.find(
    (m) => m.year === cursor.year && m.month === cursor.month
  );
  const prevMonth = shiftMonth(cursor, -1);
  const canPrev = cursor.year > 2024 || cursor.month > 1;
  const canNext = cursor.year < 2100 || cursor.month < 12;

  const gotoMonth = (delta: number) => {
    if (pending) return;
    const next = shiftMonth(cursor, delta);
    if (next.year < 2024 || next.year > 2100) return;
    setNotice(null);
    setActionError(null);
    setCursor(next);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">月班表管理</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          逐場維護每個月的班表。發布是「按月」的：設定生效時間後，時間到前台自動上架，
          不用每天手動開關；還沒發布（或還沒到生效時間）的月份，前台看不到。
        </p>
      </div>

      <MonthBar
        year={cursor.year}
        month={cursor.month}
        info={monthInfo}
        nowMs={nowMs}
        pending={pending}
        disabled={sessionsLoading}
        onPrev={() => gotoMonth(-1)}
        onNext={() => gotoMonth(1)}
        onPublish={() => handlePublish("publish")}
        onUnpublish={() => setUnpublishOpen(true)}
        onCopy={handleCopy}
      />

      {/* 顏色圖例：前台手機月曆靠它解釋顏色，標籤在這裡改 */}
      <LegendEditor />

      {!canPrev || !canNext ? (
        <p className="text-xs text-white/45">
          可管理的月份範圍是 2024 年 1 月到 2100 年 12 月。
        </p>
      ) : null}

      {notice && <AdminNotice message={notice} onDismiss={() => setNotice(null)} />}
      {actionError && (
        <AdminError message={actionError} onDismiss={() => setActionError(null)} />
      )}
      {monthsError && (
        <AdminError
          message={`發布狀態讀取失敗：${monthsError.message}`}
          onDismiss={() => setMonthsError(null)}
        />
      )}
      {classesError && <AdminError message={classesError} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-bold">
          本月場次
          <span className="ml-2 text-sm font-normal text-white/55">
            共 {sessions?.length ?? 0} 場
          </span>
        </h3>
        <button
          type="button"
          onClick={() => {
            setActionError(null);
            setDialog({ mode: "create" });
          }}
          disabled={classes.length === 0}
          title={classes.length === 0 ? "課程主檔還是空的，暫時無法排班" : undefined}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-vital px-4 py-2 text-sm font-semibold text-white transition hover:bg-vital-bright disabled:cursor-not-allowed disabled:opacity-55"
        >
          <CalendarPlus size={15} />
          新增場次
        </button>
      </div>

      {classes.length === 0 && !classesError && (
        <p className="text-xs leading-relaxed text-white/45">
          課程主檔還是空的，暫時排不了班。請聯絡工程師先把課程匯入，之後這裡就能逐場新增。
        </p>
      )}

      <SessionList
        sessions={sessions}
        loading={sessionsLoading}
        slow={slowLoading}
        error={sessionsError?.message ?? null}
        onRetry={() => {
          setSessionsErrorData(null);
          refreshSessions();
        }}
        onCreate={() => setDialog({ mode: "create" })}
        onEdit={(session) => {
          setActionError(null);
          setDialog({ mode: "edit", session });
        }}
        onDelete={(session) => {
          setDeleteError(null);
          setDeleteTarget(session);
        }}
      />

      {pending === "copy" && (
        <p className="flex items-center gap-1.5 text-xs text-white/55" aria-live="polite">
          <Loader2 size={13} className="animate-spin" />
          正在複製 {prevMonth.year} 年 {prevMonth.month} 月的場次…
        </p>
      )}

      {sessionsError && (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-amber-200/80">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">
            月份切換與發布仍可使用；場次列表請按上面的「重試」。
          </span>
        </p>
      )}

      {dialog && (
        <SessionFormDialog
          mode={dialog.mode}
          session={dialog.mode === "edit" ? dialog.session : null}
          classes={classes}
          displayedMonth={cursor}
          onClose={() => setDialog(null)}
          onSaved={handleSaved}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="刪除這場班表？"
          description={
            <div className="space-y-2">
              <p className="font-semibold text-white">
                {dateGroupLabel(deleteTarget.session_date)}{" "}
                {timeRange(deleteTarget.start_time, deleteTarget.end_time)}｜
                {deleteTarget.class_name ?? deleteTarget.title}
              </p>
              <p className="text-white/70">
                刪除後無法復原。若這一場已經有會員簽到，系統會擋下來——那種情況請改用「編輯」把狀態改成「已取消」，紀錄才會保留。
              </p>
            </div>
          }
          confirmLabel="刪除"
          pending={deleting}
          error={deleteError}
          onCancel={() => {
            if (deleting) return;
            setDeleteTarget(null);
            setDeleteError(null);
          }}
          onConfirm={handleDelete}
        />
      )}

      {unpublishOpen && (
        <ConfirmDialog
          title={`取消發布 ${cursor.year} 年 ${cursor.month} 月？`}
          description={
            <p className="text-white/75">
              取消後這個月的班表會變回草稿，前台立刻看不到。場次資料不會被刪除，之後可以再發布。
            </p>
          }
          confirmLabel="取消發布"
          tone="warn"
          pending={pending === "unpublish"}
          error={null}
          onCancel={() => {
            if (pending === "unpublish") return;
            setUnpublishOpen(false);
          }}
          onConfirm={() => {
            setUnpublishOpen(false);
            void handlePublish("unpublish");
          }}
        />
      )}
    </div>
  );
}
