"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  Loader2,
  MapPin,
  Ticket,
  User,
  Users,
  X,
} from "lucide-react";
import {
  PAID_HEX,
  RACE_HEX,
  RACE_LABEL,
  colorHex,
} from "@/components/schedule/schedule-utils";
import { feeLabel } from "@/components/hyrox/shared";

/**
 * 日期頁的當日場次清單 + 報名／取消。
 *
 * 為什麼這一段是 Client Component：
 *   日期頁是 ISR（`revalidate = 60`）。只要 Server Component 讀了 cookie／profile，
 *   整頁就會被迫轉成動態渲染，快取失效。所以「我在這幾場的報名狀態」這種
 *   只有本人看得到的資料，留給這裡在 mount 後打一次
 *   `GET /api/training/checkins?ids=…` 自己拿，頁面本體維持可快取。
 *
 * 三種列（kind）：
 *   "class"  班表堂 —— 報名／取消走這裡的 client 邏輯（原有行為，一行不改）。
 *   "hyrox"  HYROX 付費場 —— 不走站內報名，CTA 連結由 server 給
 *            （已結束 → 查看活動回顧；未結束 → 登入後報名；已登入的會員
 *             會被登入頁直接導去 /hyrox/register?event=<id>，所以不用讀
 *             profile，頁面維持可快取）。
 *   "race"   賽事 —— 只展示、不報名（CTA：查看賽事／查看賽事回顧）。
 *   樣式全部沿用堂課列的卡片（時間／名稱／地點），徽章與 CTA 顏色照
 *   月曆詳情面板（SessionDetailPanel）同一套：付費＝橙、賽事＝洋紅。
 *
 * 三個邊界（本專案鐵律）：
 *   載入中：按鈕一律 disabled，並顯示「查詢報名狀態…」；超過 3 秒改文案，
 *           不要讓使用者只看到一個轉圈。
 *   錯誤：  明確寫出「無法取得報名狀態」＋重試鈕，不靜默失敗。
 *   空狀態：當日無場次時這個元件根本不會被 render（空狀態由 page.tsx 負責，
 *           而且要「堂課＋HYROX＋賽事全部都沒有」才會成立）。
 *
 * 取消機制：fetch 掛 AbortController，元件卸載時 abort，避免卸載後 setState。
 */

export type DatedSessionView = {
  id: string;
  /** "class" = 班表堂；"hyrox" = HYROX 付費場；"race" = 賽事（只展示不報名） */
  kind: "class" | "hyrox" | "race";
  title: string;
  /** 'HH:MM' */
  startTime: string | null;
  endTime: string | null;
  coachName: string | null;
  location: string | null;
  capacity: number | null;
  /** 剩餘名額；null = 讀不到（migration-session-seats.sql 未執行） */
  remaining: number | null;
  /** 已報名人數；null = 讀不到 */
  taken: number | null;
  status: "open" | "closed" | "cancelled";
  colorKey: string | null;
  /** 課程類別中文（力量／HYROX／技巧…）；舊資料為 null */
  categoryLabel: string | null;
  /** kind = "hyrox" / "race" 的 CTA 連結（堂課為 null，走站內報名） */
  cta: { label: string; href: string } | null;
  /** HYROX 付費場＝true（CTA 用 btn-vital、徽章用付費橙） */
  paid: boolean;
  /** 報名費（分）；null = 免費／未定 */
  feeCents: number | null;
};

/** 查詢狀態的機器狀態 */
type Phase = "loading" | "ready" | "error";

export function DateSessionList({
  date,
  sessions,
  isPast,
}: {
  /** 'YYYY-MM-DD'，只用來組登入後的回跳網址 */
  date: string;
  sessions: DatedSessionView[];
  /** 今天之後才可報名；已過的日子只顯示狀態，不給報名入口 */
  isPast: boolean;
}) {
  /**
   * 報名狀態只查班表堂：HYROX／賽事不走站內報名。
   * 若當日只有 HYROX／賽事（ids 為空），**不要**打 `ids=` 的空請求：
   * API 會回 400，畫面就會誤顯示「無法取得你的報名狀態」＋重試鈕。
   * 所以初始 phase 直接按「有沒有班表堂」決定，effect 亦據此跳過。
   */
  const classIds = sessions
    .filter((s) => s.kind === "class")
    .map((s) => s.id)
    .join(",");
  const hasClassSessions = classIds !== "";

  const [phase, setPhase] = useState<Phase>(hasClassSessions ? "loading" : "ready");
  const [slow, setSlow] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [mine, setMine] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /** 重試用的遞增 key；每次 +1 就重跑 effect */
  const [attempt, setAttempt] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);

  const loginHref = `/login?next=${encodeURIComponent(`/training/${date}`)}`;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /**
   * 重試：把狀態切回 loading 之後再遞增 attempt 觸發 effect。
   * 切狀態刻意留在事件處理器裡，而不是寫在 effect 開頭——
   * effect 內同步 setState 會觸發連鎖 render（react-hooks/set-state-in-effect）。
   */
  const retry = useCallback(() => {
    setPhase("loading");
    setSlow(false);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    // 當日只有 HYROX／賽事（沒有班表堂）→ 冇報名狀態可查。
    // 直接不打請求：`ids=` 空字串會讓 API 回 400，畫面就會冒出
    // 「無法取得你的報名狀態」的假錯誤。phase 已在 useState 初始化為 ready。
    if (!hasClassSessions) return;

    const controller = new AbortController();
    abortRef.current = controller;

    // 3 秒仍未回來 → 換文案，避免只有一個轉圈
    const slowTimer = window.setTimeout(() => {
      if (aliveRef.current) setSlow(true);
    }, 3000);

    const ids = classIds;

    (async () => {
      try {
        const res = await fetch(
          `/api/training/checkins?ids=${encodeURIComponent(ids)}`,
          { signal: controller.signal, cache: "no-store" }
        );
        const data = (await res.json()) as {
          ok: boolean;
          authenticated?: boolean;
          checkins?: Record<string, string>;
        };
        if (controller.signal.aborted) return;
        if (!data.ok) {
          setPhase("error");
          return;
        }
        setAuthenticated(Boolean(data.authenticated));
        setMine(data.checkins ?? {});
        setPhase("ready");
      } catch (err) {
        // abort 不是錯誤，不要因此顯示錯誤狀態
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setPhase("error");
      } finally {
        window.clearTimeout(slowTimer);
        if (aliveRef.current) setSlow(false);
      }
    })();

    return () => {
      window.clearTimeout(slowTimer);
      controller.abort();
    };
    // 依賴用「已展開的 id 字串」而不是 sessions 陣列：
    // server 每次 render 都會給新的陣列參考，用陣列會讓這個請求多跑幾次。
  }, [classIds, hasClassSessions, attempt]);

  const act = useCallback(
    async (sessionId: string, action: "join" | "leave") => {
      setBusy(sessionId);
      setActionError(null);
      try {
        const res = await fetch("/api/training/checkins", {
          method: action === "join" ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const data = (await res.json()) as { ok: boolean; error?: string };
        if (!data.ok) {
          setActionError(data.error ?? "操作失敗，請稍後再試。");
          return;
        }
        setMine((prev) => {
          const next = { ...prev };
          if (action === "join") next[sessionId] = "pending";
          else delete next[sessionId];
          return next;
        });
      } catch {
        setActionError("網路錯誤，請稍後再試。");
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const busyAny = busy !== null;

  return (
    <div className="mt-8 space-y-4">
      {/* 查詢報名狀態的載入／錯誤提示：放在清單上方一行，不擋住已渲染的場次資料 */}
      {phase === "loading" && (
        <p className="flex items-center gap-2 text-xs text-white/55" aria-live="polite">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          {slow ? "網路較慢，仍在查詢報名狀態…" : "查詢報名狀態…"}
        </p>
      )}
      {phase === "error" && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 border-l-2 border-amber-500/70 bg-amber-500/[0.08] px-4 py-2.5 text-sm text-white/80"
        >
          <AlertTriangle size={15} className="shrink-0 text-amber-300" aria-hidden />
          <span>無法取得你的報名狀態（不影響查看場次資料）。</span>
          <button
            type="button"
            onClick={retry}
            className="min-h-11 cursor-pointer font-semibold text-accent-blue underline decoration-white/30 underline-offset-4 hover:text-white"
          >
            重試
          </button>
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          className="flex items-center gap-2 border-l-2 border-red-500/70 bg-red-500/[0.08] px-4 py-2.5 text-sm text-red-200"
        >
          <X size={15} className="shrink-0" aria-hidden />
          {actionError}
        </div>
      )}

      <ul className="space-y-4">
        {sessions.map((session) => {
          const status = mine[session.id] ?? null;
          const isBusy = busy === session.id;
          const isClass = session.kind === "class";
          const isRace = session.kind === "race";
          const timeText =
            session.startTime && session.endTime
              ? `${session.startTime}–${session.endTime}`
              : session.startTime ?? "時間待公布";
          // 徽章／左側色條的顏色：堂課用課程色票，HYROX 用付費橙，賽事用洋紅
          //（同月曆詳情面板 SessionDetailPanel 的 sessionAccentHex 語意）
          const accent = isRace
            ? RACE_HEX
            : session.kind === "hyrox"
              ? PAID_HEX
              : colorHex(session.colorKey);
          // 費用列：HYROX 一律顯示（fee=0 → feeLabel 會寫「免費」）；
          // 賽事只在真的有填報名費時顯示（null 硬寫「免費」是造假）
          const showFee = session.kind === "hyrox" || (isRace && session.feeCents !== null);

          return (
            <li
              key={`${session.kind}-${session.id}`}
              className="relative overflow-hidden border border-white/10 bg-ink-soft/70 p-5 z-raise md:p-6"
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-1"
                style={{ backgroundColor: accent }}
              />

              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="min-w-0 text-lg font-black tracking-tight text-white">
                  {session.title}
                </h3>
                {isClass ? (
                  session.categoryLabel && (
                    <span className="shrink-0 border border-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">
                      {session.categoryLabel}
                    </span>
                  )
                ) : (
                  // HYROX／賽事徽章：沿用詳情面板的付費橙／賽事洋紅樣式
                  <span
                    className="shrink-0 border px-2 py-0.5 text-[10px] font-bold tracking-[0.18em]"
                    style={{
                      color: accent,
                      borderColor: `color-mix(in srgb, ${accent} 45%, transparent)`,
                      backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`,
                    }}
                  >
                    {isRace ? RACE_LABEL : "付費場次"}
                  </span>
                )}
              </div>

              <div className="mt-3 grid gap-x-6 gap-y-1.5 text-sm text-white/70 sm:grid-cols-2">
                <span className="flex items-center gap-2">
                  <Clock size={15} className="shrink-0 text-vital-bright" aria-hidden />
                  <span className="tnum">{timeText}</span>
                </span>
                {showFee && (
                  <span className="flex items-center gap-2">
                    <Ticket size={15} className="shrink-0 text-vital-bright" aria-hidden />
                    {feeLabel(session.feeCents)}
                  </span>
                )}
                {/* 賽事沒有名額欄（raceToView capacity 一律 null），
                    硬畫「名額未定」是把「不知道」寫成假資料，整列不渲染 */}
                {!isRace && (
                  <span className="flex min-w-0 items-center gap-2">
                    <Users size={15} className="shrink-0 text-vital-bright" aria-hidden />
                    {/* 讀不到報名數就只講總名額，絕不把「不知道」畫成 0 */}
                    {session.remaining !== null && session.capacity !== null ? (
                      <span>
                        剩餘 {session.remaining} 個名額
                        <span className="text-white/45">（共 {session.capacity} 人）</span>
                      </span>
                    ) : session.capacity !== null ? (
                      <span>名額 {session.capacity} 人</span>
                    ) : (
                      <span>名額未定</span>
                    )}
                  </span>
                )}
                {session.coachName && (
                  <span className="flex min-w-0 items-center gap-2">
                    <User size={15} className="shrink-0 text-vital-bright" aria-hidden />
                    {/* 教練欄位本身就是「教練 C（示範）」這種寫法時不要再加前綴，
                        否則會出現「教練 教練 C」 */}
                    <span className="min-w-0 truncate">
                      {session.coachName.startsWith("教練")
                        ? session.coachName
                        : `教練 ${session.coachName}`}
                    </span>
                  </span>
                )}
                {session.location && (
                  <span className="flex min-w-0 items-center gap-2">
                    <MapPin size={15} className="shrink-0 text-vital-bright" aria-hidden />
                    <span className="min-w-0 truncate">{session.location}</span>
                  </span>
                )}
              </div>

              <div className="mt-5">
                {isClass ? (
                  <SessionActionArea
                    phase={phase}
                    isPast={isPast}
                    authenticated={authenticated}
                    status={status}
                    busy={isBusy}
                    busyAny={busyAny}
                    loginHref={loginHref}
                    onJoin={() => act(session.id, "join")}
                    onLeave={() => act(session.id, "leave")}
                  />
                ) : (
                  // HYROX／賽事的 CTA：顏色同詳情面板（付費＝btn-vital、賽事＝btn-cobalt）
                  session.cta && (
                    <Link
                      href={session.cta.href}
                      className={`btn-base btn-slab min-h-11 w-full text-sm sm:w-auto ${
                        session.paid ? "btn-vital" : "btn-cobalt"
                      }`}
                    >
                      {session.cta.label} <ArrowRight size={16} aria-hidden />
                    </Link>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SessionActionArea({
  phase,
  isPast,
  authenticated,
  status,
  busy,
  busyAny,
  loginHref,
  onJoin,
  onLeave,
}: {
  phase: Phase;
  isPast: boolean;
  authenticated: boolean;
  status: string | null;
  busy: boolean;
  busyAny: boolean;
  loginHref: string;
  onJoin: () => void;
  onLeave: () => void;
}) {
  // 已過的日期：先講清楚，不給按鈕
  if (isPast) {
    return (
      <p className="inline-flex min-h-11 items-center text-sm text-white/45">
        這場已結束
      </p>
    );
  }

  if (status) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span
          className={`inline-flex min-h-11 items-center gap-2 border px-4 text-sm font-semibold ${
            status === "approved"
              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
              : status === "rejected"
                ? "border-red-500/40 bg-red-500/15 text-red-300"
                : "border-amber-500/40 bg-amber-500/15 text-amber-300"
          }`}
        >
          {status === "approved" ? (
            <>
              <Check size={16} aria-hidden /> 已報名 · 已確認
            </>
          ) : status === "rejected" ? (
            "報名已駁回"
          ) : (
            "已報名 · 待確認"
          )}
        </span>
        {/* 只有「尚未確認」可以自己取消（API 的 DELETE 也只吃 status = pending） */}
        {status === "pending" && (
          <button
            type="button"
            disabled={busy}
            onClick={onLeave}
            aria-busy={busy}
            className="inline-flex min-h-11 cursor-pointer items-center text-sm text-white/70 underline decoration-white/30 underline-offset-4 transition hover:text-red-300 disabled:cursor-wait disabled:opacity-50"
          >
            {busy ? "處理中…" : "取消報名"}
          </button>
        )}
      </div>
    );
  }

  // 狀態還沒查回來：不讓使用者按下會失敗的按鈕
  if (phase === "loading") {
    return (
      <button
        type="button"
        disabled
        className="btn-base btn-ghost min-h-11 w-full cursor-wait text-sm sm:w-auto"
      >
        <Loader2 size={16} className="animate-spin" aria-hidden /> 查詢報名狀態…
      </button>
    );
  }

  if (phase === "error") {
    // 清單上方的錯誤橫幅已經有「重試」入口，這裡不再放第二顆按鈕，
    // 避免同時出現兩個看起來做同一件事的控制項。
    return null;
  }

  if (!authenticated) {
    return (
      <Link
        href={loginHref}
        className="btn-base btn-cobalt min-h-11 inline-flex w-full text-sm sm:w-auto"
      >
        登入後報名 <ArrowRight size={16} aria-hidden />
      </Link>
    );
  }

  return (
    <button
      type="button"
      disabled={busyAny}
      onClick={onJoin}
      aria-busy={busy}
      className="btn-base btn-vital min-h-11 w-full text-sm sm:w-auto"
    >
      {busy ? (
        <>
          <Loader2 size={16} className="animate-spin" aria-hidden /> 處理中…
        </>
      ) : (
        "報名這一場"
      )}
    </button>
  );
}
