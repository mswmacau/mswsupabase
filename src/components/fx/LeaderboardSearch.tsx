"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Medal,
  Search,
  Trophy,
} from "lucide-react";
import type { LeaderRow } from "@/lib/types";
import { formatKm } from "@/lib/utils";

/** 名次以「原始榜單」為準：搜尋過濾唔會重新排名，只係篩走唔啱嘅行 */
interface RankedRow {
  row: LeaderRow;
  rank: number;
}

interface Props {
  /** 月份切換器嘅月份（YYYY-MM，由新到舊） */
  months: string[];
  activeMonth: string;
  /** 已 format 好嘅月份標題（例如 "2026 年 9 月"） */
  monthLabel: string;
  monthly: LeaderRow[];
  allTime: LeaderRow[];
  goalKm: number;
  /** 上月名次對照表：user_id → 名次（1 起）。上月無資料時傳空物件 */
  prevRanks: Record<string, number | undefined>;
  /** 上月係咪有資料：false 時全部顯示「–」，唔好判成 NEW */
  prevAvailable: boolean;
}

/**
 * F-L3：算排名變化。
 * - 上月完全無資料 → "none"（顯示 –）
 * - 上月有資料但搵唔到呢個人 → "new"（顯示 NEW）
 * - 名次一樣 → "same"（顯示 –）
 * - 其餘 → delta（上月名次 - 今月名次，正數 = 上升）
 */
function rankChange(
  userId: string,
  rank: number,
  prevAvailable: boolean,
  prevRanks: Record<string, number | undefined>
): number | "none" | "same" | "new" {
  if (!prevAvailable) return "none";
  const prev = prevRanks[userId];
  if (prev === undefined) return "new";
  const delta = prev - rank;
  return delta === 0 ? "same" : delta;
}

/**
 * 排行榜互動區：月份 sticky 列 + 搜尋會員（F-L1）+ 月度榜 + 累積總榜。
 * 全部係 client component，但仍然會 SSR，所以關掉 JS 內容照出。
 */
export function LeaderboardSearch({
  months,
  activeMonth,
  monthLabel,
  monthly,
  allTime,
  goalKm,
  prevRanks,
  prevAvailable,
}: Props) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const q = query.trim().toLowerCase();

  const monthlyRanked = useMemo<RankedRow[]>(
    () => monthly.map((row, i) => ({ row, rank: i + 1 })),
    [monthly]
  );
  const allTimeRanked = useMemo<RankedRow[]>(
    () => allTime.map((row, i) => ({ row, rank: i + 1 })),
    [allTime]
  );

  const filteredMonthly = q
    ? monthlyRanked.filter((r) => r.row.name.toLowerCase().includes(q))
    : monthlyRanked;
  const filteredAllTime = q
    ? allTimeRanked.filter((r) => r.row.name.toLowerCase().includes(q))
    : allTimeRanked;

  const [podium1, podium2, podium3, ...rest] = filteredMonthly;

  return (
    <>
      {/* ============ 月份切換 + 搜尋（sticky 層疊） ============ */}
      <div className="sticky top-16 z-30 border-b border-white/10 glass md:top-20">
        <div className="container-msw flex items-center gap-4 overflow-x-auto py-3">
          <span className="hidden shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50 sm:flex">
            <CalendarDays size={14} />
            月份
          </span>
          <div className="flex shrink-0 gap-2">
            {months.map((mm) => {
              const active = mm === activeMonth;
              return (
                <Link
                  key={mm}
                  href={`/leaderboard?m=${mm}`}
                  aria-current={active ? "page" : undefined}
                  className={`stat-figure inline-flex min-h-11 items-center px-4 text-sm transition ${
                    active
                      ? "slab bg-vital text-white"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  {mm.replace("-", ".")}
                </Link>
              );
            })}
          </div>

          {/* F-L1：搜尋會員（同一條 sticky bar，唔改 ?m= 邏輯） */}
          <div className="relative ml-auto shrink-0">
            <label htmlFor={searchId} className="sr-only">
              搜尋會員
            </label>
            <Search
              size={14}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50"
            />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋會員"
              className="field w-32 py-2 pl-9 pr-3 text-sm sm:w-44 lg:w-56"
            />
          </div>
        </div>
      </div>

      {/* ============ 月度里程榜：前三名 podium + ledger ============ */}
      <section className="container-msw section-pad">
        <div className="flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-8">
          <div>
            <span className="eyebrow">Monthly Ranking</span>
            <h2 className="display-xl mt-5">{monthLabel} 里程榜</h2>
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
            目標 {goalKm} km
          </span>
        </div>

        {monthly.length ? (
          <>
            {/* 無搜尋結果：只出提示，podium 唔會出現 */}
            {!filteredMonthly.length ? (
              <NoResult />
            ) : (
              <>
                {/* 前三名：層次化 podium（#1 最高最亮） */}
                <div className="stagger mt-12 grid gap-5 lg:grid-cols-3">
                  {[podium1, podium2, podium3]
                    .filter((r): r is RankedRow => Boolean(r))
                    .map((r) => (
                      <PodiumCard
                        key={r.row.user_id}
                        row={r.row}
                        rank={r.rank}
                        goalKm={goalKm}
                        change={rankChange(
                          r.row.user_id,
                          r.rank,
                          prevAvailable,
                          prevRanks
                        )}
                      />
                    ))}
                </div>

                {/* 第 4 名之後：節奏式 ledger 排版 */}
                {rest.length > 0 && (
                  <div className="mt-12 overflow-x-auto">
                    <table className="ledger min-w-[600px]">
                      <thead>
                        <tr>
                          <th className="w-24">名次</th>
                          <th>會員</th>
                          <th className="w-40">達標進度</th>
                          <th className="w-32 text-right">里程</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rest.map((r) => (
                          <RankRow
                            key={r.row.user_id}
                            row={r.row}
                            rank={r.rank}
                            goalKm={goalKm}
                            change={rankChange(
                              r.row.user_id,
                              r.rank,
                              prevAvailable,
                              prevRanks
                            )}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <div className="mt-10 border-y border-white/10 px-6 py-16 text-center">
            <Medal size={30} className="mx-auto text-white/40" />
            <p className="mt-4 text-sm text-white/70">
              本月尚無已確認紀錄，成為第一位上榜者！
            </p>
            <Link href="/run" className="btn-base btn-vital btn-slab mt-6">
              上傳跑步紀錄 <ArrowRight size={17} />
            </Link>
          </div>
        )}
      </section>

      {/* ============ 累積總榜：透明層次，與月度榜區分 ============ */}
      <section className="relative border-y border-ink-line bg-ink-soft">
        <div className="noise-overlay" />
        <div className="container-msw section-pad relative">
          <div className="flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-8">
            <div>
              <span className="eyebrow">All Time</span>
              <h2 className="display-xl mt-5">累積總榜</h2>
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
              總里程 / 積分
            </span>
          </div>

          {allTime.length ? (
            filteredAllTime.length ? (
              <div className="stagger mt-12 grid gap-px sm:grid-cols-2">
                {filteredAllTime.map((r) => (
                  <AllTimeRow key={r.row.user_id} row={r.row} rank={r.rank} />
                ))}
              </div>
            ) : (
              <NoResult />
            )
          ) : (
            <div className="mt-10 border-y border-white/10 px-6 py-16 text-center text-sm text-white/70">
              尚無資料。
            </div>
          )}
        </div>
      </section>
    </>
  );
}

/** 空結果提示（Brief F-L1：顯示「搵唔到會員」） */
function NoResult() {
  return (
    <div className="mt-10 border-y border-white/10 px-6 py-14 text-center">
      <Search size={26} className="mx-auto text-white/40" />
      <p className="mt-4 text-sm text-white/70">搵唔到會員</p>
    </div>
  );
}

/** F-L3：排名升降標記 */
function ChangeMark({ change }: { change: number | "none" | "same" | "new" }) {
  if (change === "new") {
    return (
      <span className="stat-figure inline-flex items-center border border-vital/50 bg-vital/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-vital-bright">
        NEW
      </span>
    );
  }

  if (change === "none" || change === "same") {
    return (
      <span className="inline-flex min-w-[1.5rem] justify-center text-[11px] text-white/40">
        <span aria-hidden>–</span>
        <span className="sr-only">
          {change === "none" ? "上月無排名資料" : "排名無變化"}
        </span>
      </span>
    );
  }

  const up = change > 0;
  return (
    <span
      className={`stat-figure inline-flex min-w-[1.5rem] items-center justify-center gap-0.5 text-[11px] ${
        up ? "text-emerald-300" : "text-red-300"
      }`}
    >
      <span aria-hidden>{up ? "↑" : "↓"}</span>
      {Math.abs(change)}
      <span className="sr-only">
        {up ? `上升 ${Math.abs(change)} 名` : `下降 ${Math.abs(change)} 名`}
      </span>
    </span>
  );
}

/** F-L2：只用現有欄位 runs / points / total_km */
function RowDetail({
  row,
  id,
  open,
}: {
  row: LeaderRow;
  id: string;
  open: boolean;
}) {
  const items = [
    { label: "提交", value: String(row.runs), unit: "次" },
    { label: "積分", value: String(row.points), unit: "" },
    { label: "里程", value: formatKm(row.total_km), unit: "km" },
  ];

  return (
    <div
      id={id}
      // 收起時用 max-height 0 + overflow hidden 做 transition；內容照樣喺 DOM 入面
      className={`overflow-hidden transition-[max-height] duration-300 ${
        open ? "max-h-40" : "max-h-0"
      }`}
    >
      <dl className="grid grid-cols-3 gap-4 border-l-2 border-vital px-4 pb-5 pt-3 sm:max-w-xs">
        {items.map((it) => (
          <div key={it.label}>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
              {it.label}
            </dt>
            <dd className="mt-1 flex items-baseline gap-1">
              <span className="stat-figure text-xl text-white">
                {it.value}
              </span>
              {it.unit && (
                <span className="text-accent-blue text-[10px] font-semibold uppercase tracking-[0.22em]">
                  {it.unit}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 前三名：層次化卡片（#1 強調色描邊 + 更高抬升） */
function PodiumCard({
  row,
  rank,
  goalKm,
  change,
}: {
  row: LeaderRow;
  rank: number;
  goalKm: number;
  change: number | "none" | "same" | "new";
}) {
  const pct = goalKm > 0 ? Math.min(100, (row.total_km / goalKm) * 100) : 0;
  const isFirst = rank === 1;
  const accentClass =
    rank === 1
      ? "border-vital/60 bg-vital/[0.06]"
      : rank === 2
        ? "border-white/20 bg-ink/50"
        : "border-white/10 bg-transparent";

  return (
    <article
      className={`group relative overflow-hidden border p-7 z-raise ${accentClass} ${
        isFirst ? "lg:-mt-6" : rank === 3 ? "lg:mt-6" : ""
      }`}
    >
      {/* 巨型名次數字 */}
      <span
        aria-hidden
        className={`rank-figure pointer-events-none absolute -top-5 right-4 text-8xl transition-colors duration-500 md:text-9xl ${
          isFirst ? "text-vital/25" : "text-white/[0.06]"
        }`}
      >
        {String(rank).padStart(2, "0")}
      </span>

      <div className="relative">
        <div className="flex items-center gap-2.5">
          <span
            className={`slab inline-flex items-center gap-1.5 border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${
              isFirst
                ? "border-vital/60 bg-vital/15 text-vital-bright"
                : "border-white/15 bg-white/5 text-white/70"
            }`}
          >
            {rank === 1 ? <Trophy size={12} /> : <Medal size={12} />}
            Rank {rank}
          </span>
          <ChangeMark change={change} />
        </div>

        <h3 className="mt-6 truncate text-xl font-black tracking-tight">
          {row.name}
        </h3>
        <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
          {row.runs} 次提交 · {row.points} 積分
        </div>

        <div className="mt-8 flex items-end gap-2">
          <span
            className={`stat-figure text-5xl leading-none md:text-6xl ${
              isFirst ? "text-vital-bright" : "text-white"
            }`}
          >
            {formatKm(row.total_km)}
          </span>
          <span className="text-accent-blue mb-1.5 text-[11px] font-semibold uppercase tracking-[0.22em]">
            km
          </span>
        </div>

        {/* 達標進度：細軌 */}
        <div className="mt-6">
          <div className="meter">
            <div className="meter-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
            <span>進度</span>
            <span className="tnum">{Math.round(pct)}%</span>
          </div>
        </div>
      </div>
    </article>
  );
}

/** 第 4 名之後：ledger 行（F-L2：可展開明細） */
function RankRow({
  row,
  rank,
  goalKm,
  change,
}: {
  row: LeaderRow;
  rank: number;
  goalKm: number;
  change: number | "none" | "same" | "new";
}) {
  const [open, setOpen] = useState(false);
  const detailId = `rank-detail-${row.user_id}`;
  const pct = goalKm > 0 ? Math.min(100, (row.total_km / goalKm) * 100) : 0;

  return (
    <>
      <tr className="row-em">
        <td>
          <span className="rank-figure text-2xl text-white/30">
            {String(rank).padStart(2, "0")}
          </span>
        </td>
        <td className="min-w-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={detailId}
              onClick={() => setOpen((v) => !v)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{row.name}</span>
                <span className="mt-0.5 block text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
                  {row.runs} 次提交 · {row.points} 積分
                </span>
              </span>
              <ChevronDown
                size={16}
                aria-hidden
                className={`flex-none text-white/50 transition-transform duration-300 ${
                  open ? "-rotate-180" : ""
                }`}
              />
            </button>
            <span className="flex-none">
              <ChangeMark change={change} />
            </span>
          </div>
        </td>
        <td>
          <div className="meter max-w-[150px]">
            <div className="meter-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="tnum mt-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
            {Math.round(pct)}%
          </div>
        </td>
        <td className="text-right">
          <span className="stat-figure text-xl text-white">
            {formatKm(row.total_km)}
          </span>
          <span className="text-accent-blue ml-1 text-[11px] font-semibold uppercase tracking-[0.22em]">
            km
          </span>
        </td>
      </tr>
      <tr>
        <td colSpan={4} className="p-0">
          <RowDetail row={row} id={detailId} open={open} />
        </td>
      </tr>
    </>
  );
}

/** 累積總榜行（F-L2：可展開明細） */
function AllTimeRow({ row, rank }: { row: LeaderRow; rank: number }) {
  const [open, setOpen] = useState(false);
  const detailId = `alltime-detail-${row.user_id}`;

  return (
    <div className="group row-em flex flex-col border-b border-white/10 py-5 pr-4 transition-colors duration-500 hover:bg-white/[0.03]">
      <div className="flex items-center gap-5">
        <span className="rank-figure w-14 shrink-0 text-4xl text-white/25 md:text-5xl">
          {String(rank).padStart(2, "0")}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{row.name}</span>
            <span className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
              {row.runs} 次提交 · {row.points} 積分
            </span>
          </span>
          <ChevronDown
            size={16}
            aria-hidden
            className={`flex-none text-white/50 transition-transform duration-300 ${
              open ? "-rotate-180" : ""
            }`}
          />
        </button>
        <div className="shrink-0 text-right">
          <div className="stat-figure text-2xl text-white md:text-3xl">
            {formatKm(row.total_km)}
          </div>
          <div className="text-accent-blue text-[11px] font-semibold uppercase tracking-[0.22em]">
            km
          </div>
        </div>
      </div>
      <RowDetail row={row} id={detailId} open={open} />
    </div>
  );
}
