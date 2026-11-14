import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
  CircleDashed,
  Clock,
  ClipboardCheck,
  History,
  TicketCheck,
  Trophy,
  Users,
} from "lucide-react";
import {
  getAdminDecisions,
  getAdminMonthProgress,
  getAdminQuickStats,
  getAdminTodoCounts,
  getAdminUpcomingSessions,
  getRecentAuditLog,
} from "@/lib/queries";
import {
  currentMonth,
  formatDateTime,
  formatKm,
  monthLabel,
  todayISO,
  weekdayLabel,
} from "@/lib/utils";

export const metadata = { title: "後台總覽" };
export const dynamic = "force-dynamic";

/**
 * /admin — 今日工作台（IA 重整第一階段 20261114）
 *
 * 改寫原因：舊版是「兩張虛榮數字卡（累積里程、會員總數）＋四張行動卡」，
 * 而行動卡裡有三張常年是 0 或根本不是數字（第 3 張寫「發券」兩個字）。
 * 結果是——在「一切正常」的那一天，這一頁沒有任何可操作的內容，
 * 也回答不了管理員每天真正會問的三個問題：今天幾場？誰會來？什麼等我按？
 *
 * 現在固定五個區塊（順序即優先序），資料**全部來自既有表的唯讀查詢**
 * （src/lib/queries.ts 的 getAdminTodoCounts / getAdminUpcomingSessions /
 * getAdminMonthProgress / getAdminDecisions / getRecentAuditLog），
 * 沒有新增功能、沒有寫入、沒有動任何 API 或 schema。
 *
 * 顯示紀律：任何查詢失敗一律顯示「—」並附一行可讀提示，**不顯示 0**
 * ——把失敗畫成 0，等於告訴管理員「今天沒事」，比留白更危險。
 */

/** 數字 → 字串；null（查詢失敗）顯示「—」 */
function num(value: number | null): string {
  return value === null ? "—" : String(value);
}

/** '2026-11-14' → '2026 年 11 月 14 日（星期五）' */
function fullDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y} 年 ${m} 月 ${d} 日（星期${weekdayLabel(iso)}）`;
}

/** Postgres time '19:00:00' → '19:00' */
function shortTime(time: string | null | undefined): string | null {
  return time ? time.slice(0, 5) : null;
}

/** 三個狀態燈（本月場次／本月發布／下月）共用的樣式 */
function StatusPill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "idle";
  children: React.ReactNode;
}) {
  const styles = {
    ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    warn: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    idle: "border-white/15 bg-white/5 text-white/60",
  } as const;
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" ? AlertTriangle : CircleDashed;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${styles[tone]}`}
    >
      <Icon size={13} aria-hidden />
      {children}
    </span>
  );
}

export default async function AdminHome() {
  const today = todayISO();

  // 本月進度先查，因為「需要你決定」要用它的結果（避免同一張表查兩次）
  const progress = await getAdminMonthProgress();

  const [todos, upcoming, decisions, audit, quickStats] = await Promise.all([
    getAdminTodoCounts(),
    getAdminUpcomingSessions(3),
    getAdminDecisions(progress),
    getRecentAuditLog(5),
    getAdminQuickStats(),
  ]);

  const todoCards = [
    {
      href: "/admin/runs",
      icon: <ClipboardCheck size={18} />,
      label: "跑步待審",
      value: todos.pendingRuns,
    },
    {
      href: "/admin/checkins",
      icon: <Users size={18} />,
      label: "簽到待確認",
      value: todos.pendingCheckins,
    },
    {
      href: "/admin/redemptions?status=pending_approval",
      icon: <TicketCheck size={18} />,
      label: "兌換待審批",
      value: todos.pendingRedemptions,
    },
    {
      href: "/admin/hyrox",
      icon: <Trophy size={18} />,
      label: "HYROX 待確認付款",
      value: todos.pendingHyroxPayments,
    },
  ];

  const todoValues = todoCards.map((c) => c.value);
  const todoAllKnown = todoValues.every((v) => v !== null);
  const todoTotal = todoAllKnown
    ? (todoValues as number[]).reduce((sum, v) => sum + v, 0)
    : null;

  return (
    <div className="space-y-6">
      {/* ===== 標題列 ===== */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold">今日工作台</h2>
          <p className="mt-1 text-sm text-white/70">{fullDateLabel(today)}</p>
        </div>
        <Link href="/admin/schedule" className="btn-base btn-cobalt shrink-0">
          <CalendarPlus size={17} aria-hidden />
          新增場次
        </Link>
      </div>

      {/* ===== 1. 等你處理 ===== */}
      <section aria-labelledby="todo-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="todo-heading" className="text-base font-bold">
            等你處理
          </h3>
          <p className="text-xs text-white/60">
            {todoAllKnown
              ? todoTotal === 0
                ? "共 0 件 · 今天沒有待處理事項"
                : `共 ${todoTotal} 件`
              : "件數暫時無法確認"}
          </p>
        </div>

        {/*
         * 四張卡**永遠**渲染（包含全部為 0 的那天）。
         * 上一位的寫法在總和為 0 時把整組卡換成一行文字，於是「一切正常」的
         * 那天首頁只剩四個區塊、也看不到四個入口——而「今天真的 0 件」本身
         * 就是管理員要的答案，不該用一行文字取代導覽入口。
         * 上面的小字會在 0 件時補一句「今天沒有待處理事項」。
         */}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {todoCards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="card-dark group flex min-h-[88px] flex-col justify-between p-4 transition hover:border-cobalt/50"
            >
              <span className="flex items-center gap-2 text-xs text-white/70">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/5">
                  {card.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{card.label}</span>
              </span>
              <span className="mt-2 flex items-end justify-between gap-2">
                <span
                  className={`text-2xl font-black ${
                    card.value === null
                      ? "text-white/40"
                      : card.value === 0
                        ? "text-white/60"
                        : "text-vital-bright"
                  }`}
                >
                  {num(card.value)}
                </span>
                <ArrowRight
                  size={16}
                  className="mb-1 shrink-0 text-white/40 transition group-hover:translate-x-0.5 group-hover:text-white/70"
                  aria-hidden
                />
              </span>
              {card.value === null && (
                <span className="mt-1 text-[11px] text-white/45">
                  讀取失敗，請重新整理
                </span>
              )}
            </Link>
          ))}
        </div>
      </section>

      {/* ===== 2. 今日與未來 3 天場次 ===== */}
      <section aria-labelledby="upcoming-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="upcoming-heading" className="text-base font-bold">
            今日與未來 3 天場次
            {upcoming.ok ? `（${upcoming.rows.length} 場）` : ""}
          </h3>
          <Link
            href="/admin/schedule"
            className="text-xs font-semibold text-white/70 underline underline-offset-2 hover:text-white"
          >
            看完整班表
          </Link>
        </div>

        {!upcoming.ok ? (
          <div
            role="alert"
            className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
          >
            場次資料暫時讀不到，請重新整理頁面；若持續失敗請聯絡技術人員。
          </div>
        ) : upcoming.rows.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-white/15 px-4 py-10 text-center text-sm text-white/70">
            今天與未來 3 天沒有安排場次
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-ink-line overflow-hidden rounded-xl border border-ink-line">
            {upcoming.rows.map((session) => {
              const start = shortTime(session.start_time);
              const end = shortTime(session.end_time);
              const isToday = session.session_date === today;
              return (
                <li
                  key={session.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"
                >
                  <span className="shrink-0 font-semibold sm:w-[7.5rem]">
                    {isToday
                      ? "今天"
                      : `${session.session_date.slice(5).replace("-", "/")}（週${weekdayLabel(session.session_date)}）`}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-white/80">
                    <Clock size={14} aria-hidden />
                    {start ? `${start}${end ? `–${end}` : ""}` : "時間未定"}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {session.class_name ?? session.title}
                  </span>
                  <span className="min-w-0 max-w-[10rem] truncate text-xs text-white/60">
                    {session.location_override ?? session.location ?? "場地未定"}
                  </span>
                  <span className="shrink-0 text-xs text-white/70">
                    {session.registered < 0
                      ? "報名 —"
                      : `已報名 ${session.registered}／${session.capacity}`}
                    {session.checked_in >= 0 && session.checked_in > 0
                      ? ` · 已簽 ${session.checked_in}`
                      : ""}
                  </span>
                  {session.status !== "open" && (
                    <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/60">
                      {session.status === "closed" ? "已截止" : "已取消"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ===== 3. 本月進度 ===== */}
      <section aria-labelledby="month-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="month-heading" className="text-base font-bold">
            本月進度（{progress.monthText}）
          </h3>
          <Link
            href="/admin/schedule"
            className="text-xs font-semibold text-white/70 underline underline-offset-2 hover:text-white"
          >
            去月班表
          </Link>
        </div>

        <div className="card-dark mt-3 space-y-3 p-4">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs text-white/60">本月場次</dt>
              <dd className="mt-1 text-lg font-black">
                {num(progress.sessionCount)}
                <span className="ml-1 text-xs font-normal text-white/60">場</span>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-white/60">本月班表</dt>
              <dd className="mt-1">
                {progress.publishState === null ? (
                  <StatusPill tone="idle">讀取失敗</StatusPill>
                ) : progress.publishState === "published" ? (
                  <StatusPill tone="ok">已發布</StatusPill>
                ) : progress.publishState === "draft" ? (
                  <StatusPill tone="warn">草稿（未發布）</StatusPill>
                ) : (
                  <StatusPill tone="idle">未建立</StatusPill>
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-white/60">
                下月（{progress.nextMonthText}）
              </dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                {progress.nextState === null ? (
                  <StatusPill tone="idle">讀取失敗</StatusPill>
                ) : progress.nextState === "published" ? (
                  <StatusPill tone="ok">已發布</StatusPill>
                ) : progress.nextState === "draft" ? (
                  <StatusPill tone="warn">草稿（未發布）</StatusPill>
                ) : (
                  <StatusPill tone="idle">未建立</StatusPill>
                )}
                <span className="text-xs text-white/60">
                  {num(progress.nextSessionCount)} 場
                </span>
              </dd>
            </div>
          </dl>

          {/* 虛榮數字降級成一行小字：不引導任何行動，就不該佔一張大卡。
              兩顆數字都可能查詢失敗 → 顯示「—」，不顯示 0（見 getAdminQuickStats） */}
          <p className="border-t border-ink-line pt-2.5 text-xs text-white/55">
            全站累積里程{" "}
            <span className="tabular-nums text-white/80">
              {quickStats.totalKm === null ? "—" : formatKm(quickStats.totalKm)}
            </span>{" "}
            km · 會員{" "}
            <span className="tabular-nums text-white/80">
              {quickStats.members === null ? "—" : quickStats.members}
            </span>{" "}
            位 · 本月發券名單{" "}
            <Link
              href={`/admin/monthly?m=${currentMonth()}`}
              className="underline underline-offset-2 hover:text-white"
            >
              {monthLabel(currentMonth())}
            </Link>
          </p>
        </div>
      </section>

      {/*
       * ===== 4. 需要你決定 =====
       * 這一區**永遠渲染**（三態），理由：上一位只在 items.length > 0 時才輸出
       * section，於是「真的沒事」的那天首頁只剩 4 個區塊，而管理員無法分辨
       * 「沒有事要決定」與「這一區不見了／載入失敗」。三態各有明確文案。
       */}
      <section aria-labelledby="decisions-heading">
        <h3 id="decisions-heading" className="text-base font-bold">
          需要你決定
        </h3>

        {decisions.items.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {decisions.items.map((item) => (
              <li key={item.key}>
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  <AlertTriangle
                    size={16}
                    className="shrink-0 text-amber-300"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">{item.text}</span>
                  <Link
                    href={item.href}
                    className="shrink-0 rounded-lg border border-amber-300/40 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-400/15"
                  >
                    去處理
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : decisions.ok ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            <CheckCircle2 size={16} className="shrink-0" aria-hidden />
            目前沒有需要你決定的事
          </div>
        ) : (
          <div
            role="alert"
            className="mt-3 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white/70"
          >
            目前無法判斷班表發布狀態與 HYROX 收款碼狀態，請稍後重新整理。
          </div>
        )}
      </section>

      {/* ===== 5. 最近操作 ===== */}
      <section aria-labelledby="audit-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="audit-heading" className="text-base font-bold">
            最近操作
          </h3>
          <Link
            href="/admin/audit-log"
            className="text-xs font-semibold text-white/70 underline underline-offset-2 hover:text-white"
          >
            全部紀錄
          </Link>
        </div>

        {!audit.ok ? (
          <div
            role="alert"
            className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
          >
            操作紀錄暫時讀不到，請重新整理頁面。
          </div>
        ) : audit.rows.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-white/15 px-4 py-10 text-center text-sm text-white/70">
            尚無操作紀錄
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-ink-line overflow-hidden rounded-xl border border-ink-line">
            {audit.rows.map((row) => {
              const actor = Array.isArray(row.profile)
                ? row.profile[0] ?? null
                : row.profile;
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
                >
                  <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-xs text-white/55">
                    <History size={13} aria-hidden />
                    {formatDateTime(row.created_at)}
                  </span>
                  <span className="shrink-0 text-xs text-white/70">
                    {actor?.display_name ?? "已刪除帳號"}
                  </span>
                  <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/60">
                    {row.module} · {row.action}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-white/80">
                    {row.summary}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
