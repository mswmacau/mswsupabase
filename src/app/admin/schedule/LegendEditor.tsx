"use client";

/**
 * src/app/admin/schedule/LegendEditor.tsx — 顏色圖例編輯器
 *
 * 客戶原話：「如果看不到，上方可以說明顏色所代表的活動，並且後台同步」
 * 前台手機日曆只畫顏色短條、不寫課名，所以這裡改的每一個 label 就是
 * 使用者在手機上唯一讀得到的解釋 —— 改完要能立刻反映，不能改了沒生效。
 *
 * 資料來源：/api/admin/training/legend（GET 全部含停用 / POST update / POST reset）
 * 六種顏色是固定的（blue / green / amber / teal / violet / orange），
 * 對應前台 colorHex()，這裡只能改「名稱、順序、是否顯示」，不能新增顏色。
 *
 * 三個必處理的邊界（與本頁其他區塊一致）：
 *   · loading —— 骨架 + 超過 3 秒換文案
 *   · error   —— 可讀訊息 + 重試
 *   · schema  —— 表未建時顯示 migration 引導，不是空白也不是紅字 500
 *
 * 生命週期：fetch 帶 AbortController，卸載時 abort 並清 timer；
 * 已載入／錯誤都綁在 token 上，換 token 後舊資料自然失效（不在 effect 同步 setState）。
 */

import { useEffect, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Database,
  Loader2,
  RotateCw,
  Save,
} from "lucide-react";
import { AdminError, AdminNotice, ConfirmDialog } from "@/components/admin/ui";
import {
  fetchScheduleLegend,
  isAbortError,
  resetScheduleLegend,
  toCode,
  toMessage,
  updateScheduleLegendItem,
  type LegendItem,
} from "./api";

/**
 * 色票鍵 → hex。
 * 刻意不 import `@/components/schedule/schedule-utils`：那是前台日曆的模組，
 * 後台不該為了三個色塊把前台的程式拉進 bundle。值必須與前台一致。
 */
const LEGEND_HEX: Record<string, string> = {
  blue: "#378ADD",
  green: "#639922",
  amber: "#EF9F27",
  teal: "#1D9E75",
  violet: "#534AB7",
  orange: "#F9761F",
};

function legendHex(colorKey: string): string {
  return LEGEND_HEX[colorKey] ?? "#9ca3af";
}

const LABEL_MAX = 20;

type Keyed = { token: number; items: LegendItem[] };
type KeyedError = { token: number; message: string; schema: boolean };

export function LegendEditor() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(0);

  const [data, setData] = useState<Keyed | null>(null);
  const [errorData, setErrorData] = useState<KeyedError | null>(null);
  const [slowToken, setSlowToken] = useState<number | null>(null);

  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  /* 編輯中的內容也綁 token：重新載入後舊的未存編輯自然失效，
   * 不會出現「畫面上是舊值、DB 是新值」的假象。 */
  const items = data?.token === token ? data.items : null;
  const loadError = errorData?.token === token ? errorData : null;
  const loading = items === null && loadError === null;
  const slow = loading && slowToken === token;

  /* ---------- 讀取 ---------- */
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    fetchScheduleLegend(controller.signal)
      .then((res) => {
        if (!alive) return;
        setData({ token, items: res.legend });
        setErrorData(null);
      })
      .catch((err: unknown) => {
        if (!alive || isAbortError(err)) return;
        setData(null);
        setErrorData({
          token,
          message: toMessage(err, "圖例載入失敗，請稍後再試。"),
          schema: toCode(err) === "SCHEMA_OUTDATED",
        });
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [token]);

  /* ---------- 超過 3 秒換文案（setState 在 timer 回呼裡） ---------- */
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setSlowToken(token), 3000);
    return () => clearTimeout(timer);
  }, [loading, token]);

  const reload = () => {
    setErrorData(null);
    setToken((n) => n + 1);
  };

  /* ---------- 本地編輯 ---------- */
  function patchItem(colorKey: string, patch: Partial<LegendItem>) {
    setData((current) => {
      if (!current || current.token !== token) return current;
      return {
        token: current.token,
        items: current.items.map((item) =>
          item.color_key === colorKey ? { ...item, ...patch } : item
        ),
      };
    });
    setNotice(null);
  }

  /** 上下移：交換相鄰兩筆的位置，並把整個清單的 sort_order 重編成 1..N */
  function move(index: number, delta: number) {
    setData((current) => {
      if (!current || current.token !== token) return current;
      const target = index + delta;
      if (target < 0 || target >= current.items.length) return current;
      const next = [...current.items];
      [next[index], next[target]] = [next[target], next[index]];
      return {
        token: current.token,
        items: next.map((item, i) => ({ ...item, sort_order: i + 1 })),
      };
    });
    setNotice(null);
  }

  const labelInvalid =
    items?.some((item) => {
      const trimmed = item.label.trim();
      return trimmed.length < 1 || trimmed.length > LABEL_MAX;
    }) ?? false;

  /* ---------- 儲存：逐筆送出（契約只有單筆 update） ---------- */
  async function handleSave() {
    if (!items || pending || labelInvalid) return;

    setPending(true);
    setActionError(null);
    setNotice(null);

    let saved = 0;
    try {
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        await updateScheduleLegendItem({
          color_key: item.color_key,
          label: item.label.trim(),
          sort_order: i + 1,
          is_active: item.is_active,
        });
        saved += 1;
      }

      setNotice("圖例已儲存，前台 /events 會即時更新（最多約 1 分鐘）。");
      // 以伺服器為準重抓，避免本地狀態與 DB 不一致
      setToken((n) => n + 1);
    } catch (err) {
      const message = toMessage(err, "儲存失敗，請稍後再試。");
      setActionError(
        saved === 0
          ? message
          : `已儲存前 ${saved} 筆，第 ${saved + 1} 筆失敗：${message}`
      );
    } finally {
      setPending(false);
    }
  }

  async function handleReset() {
    if (resetting) return;

    setResetting(true);
    setActionError(null);
    setNotice(null);

    try {
      const res = await resetScheduleLegend();
      setResetOpen(false);
      setNotice(`${res.message}前台 /events 會即時更新（最多約 1 分鐘）。`);
      setToken((n) => n + 1);
    } catch (err) {
      setResetOpen(false);
      setActionError(toMessage(err, "還原失敗，請稍後再試。"));
    } finally {
      setResetting(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-ink-line">
      <h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="legend-editor-body"
          className="flex w-full items-center gap-2.5 border-b border-ink-line bg-white/[0.03] px-4 py-3 text-left text-sm font-bold text-white/85 transition hover:bg-white/[0.06]"
        >
          {open ? (
            <ChevronDown size={15} className="shrink-0 text-white/50" />
          ) : (
            <ChevronRight size={15} className="shrink-0 text-white/50" />
          )}
          顏色圖例
          <span className="ml-auto shrink-0 text-xs font-normal text-white/45">
            {open ? "收合" : "展開編輯"}
          </span>
        </button>
      </h3>

      {open && (
        <div id="legend-editor-body" className="px-4 py-4">
          <p className="text-xs leading-relaxed text-white/55">
            手機的月曆格子放不下課名，改用顏色短條表示，前台靠這份圖例解釋顏色。
            改完按「儲存圖例」，前台 /events 會即時更新。
          </p>

          {notice && (
            <div className="mt-3">
              <AdminNotice message={notice} onDismiss={() => setNotice(null)} />
            </div>
          )}
          {actionError && (
            <div className="mt-3">
              <AdminError message={actionError} onDismiss={() => setActionError(null)} />
            </div>
          )}

          {/* ---- 表未建：給引導，不要空白也不要紅字 500 ---- */}
          {loadError?.schema ? (
            <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-6 text-center">
              <Database size={22} className="mx-auto text-amber-300" />
              <p className="mx-auto mt-3 max-w-md break-words text-sm leading-relaxed text-amber-100/90">
                {loadError.message}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-amber-100/70">
                在 Supabase SQL Editor 執行{" "}
                <code className="break-all font-mono">
                  supabase/migration-schedule-legend.sql
                </code>
                ，跑完按下面的「重新檢查」。還沒執行也不影響日曆運作，
                前台只是不顯示圖例。
              </p>
              <button
                type="button"
                onClick={reload}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 px-4 py-1.5 text-xs font-semibold text-amber-100 transition hover:border-amber-300 hover:text-white"
              >
                <RotateCw size={13} />
                重新檢查
              </button>
            </div>
          ) : loadError ? (
            /* ---- 其他錯誤：可讀訊息 + 重試 ---- */
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-6 text-center"
            >
              <AlertCircle size={22} className="mx-auto text-red-300" />
              <p className="mx-auto mt-3 max-w-md break-words text-sm leading-relaxed text-red-100">
                {loadError.message}
              </p>
              <button
                type="button"
                onClick={reload}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/25 px-4 py-1.5 text-xs font-semibold text-white/85 transition hover:border-white/50 hover:text-white"
              >
                <RotateCw size={13} />
                重試
              </button>
            </div>
          ) : loading ? (
            /* ---- 載入中 ---- */
            <div className="mt-4 space-y-2" aria-hidden="true">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-3">
                  <div className="h-4 w-4 animate-pulse rounded bg-white/10" />
                  <div className="h-4 w-16 animate-pulse rounded bg-white/10" />
                  <div className="h-4 flex-1 animate-pulse rounded bg-white/10" />
                </div>
              ))}
              <p className="pt-1 text-xs text-white/55" aria-live="polite">
                {slow ? "載入較慢，仍在處理…" : "正在載入圖例…"}
              </p>
            </div>
          ) : items && items.length === 0 ? (
            /* ---- 表已建立但沒有資料 ---- */
            <div className="mt-4 rounded-xl border border-dashed border-white/15 px-4 py-8 text-center">
              <p className="text-sm leading-relaxed text-white/70">
                目前沒有圖例資料。按「還原預設」可以帶回六種預設顏色。
              </p>
            </div>
          ) : items ? (
            <>
              <ul className="mt-4 divide-y divide-ink-line rounded-xl border border-ink-line">
                {items.map((item, index) => {
                  const label = item.label;
                  const invalid = label.trim().length < 1 || label.trim().length > LABEL_MAX;
                  const inputId = `legend-label-${item.color_key}`;

                  return (
                    <li
                      key={item.color_key}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
                    >
                      <span
                        aria-hidden
                        className="h-3.5 w-3.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: legendHex(item.color_key) }}
                      />
                      <span className="w-[56px] shrink-0 font-mono text-[11px] text-white/45">
                        {item.color_key}
                      </span>

                      <input
                        id={inputId}
                        type="text"
                        value={label}
                        maxLength={LABEL_MAX}
                        aria-label={`${item.color_key} 的圖例名稱`}
                        aria-invalid={invalid}
                        onChange={(e) => patchItem(item.color_key, { label: e.target.value })}
                        className={`min-w-0 flex-1 basis-[140px] rounded-lg border bg-ink/60 px-2.5 py-1.5 text-sm text-white outline-none transition focus:border-vital-bright/70 ${
                          invalid ? "border-red-500/60" : "border-white/15"
                        }`}
                      />

                      <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-white/70">
                        <input
                          type="checkbox"
                          checked={item.is_active}
                          onChange={(e) =>
                            patchItem(item.color_key, { is_active: e.target.checked })
                          }
                          className="h-3.5 w-3.5 accent-vital"
                        />
                        啟用
                      </label>

                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => move(index, -1)}
                          disabled={index === 0}
                          aria-label={`上移 ${item.label || item.color_key}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(index, 1)}
                          disabled={index === items.length - 1}
                          aria-label={`下移 ${item.label || item.color_key}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {labelInvalid && (
                <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-amber-200/85">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  名稱需為 1–{LABEL_MAX} 個字，修正後才能儲存。
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={pending || labelInvalid}
                  className="inline-flex items-center gap-1.5 rounded-full bg-vital px-4 py-2 text-sm font-semibold text-white transition hover:bg-vital-bright disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {pending ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Save size={15} />
                  )}
                  {pending ? "儲存中…" : "儲存圖例"}
                </button>

                <button
                  type="button"
                  onClick={() => setResetOpen(true)}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <RotateCw size={14} />
                  還原預設
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {resetOpen && (
        <ConfirmDialog
          title="還原預設圖例？"
          description={
            <p className="text-white/75">
              還原後六筆圖例的名稱、順序與啟用狀態都會回到預設值，你改過的名稱會被覆蓋。
            </p>
          }
          confirmLabel="還原預設"
          tone="warn"
          pending={resetting}
          error={null}
          onCancel={() => {
            if (resetting) return;
            setResetOpen(false);
          }}
          onConfirm={handleReset}
        />
      )}
    </section>
  );
}
