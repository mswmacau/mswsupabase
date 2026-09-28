"use client";

/**
 * F-T1 下場訓練倒數卡 / F-T2 加入日曆（Brief §2.2）
 *
 * 數據全部由 props（page 已有嘅 upcoming[0]）同 RULES 提供，唔加新 query、
 * 唔 hardcode 任何日期時間。
 *
 * Hydration 安全：server / client 第一次 render 一律輸出同一份內容
 * （倒數位置顯示佔位符），一定要喺 useEffect（mount 後）先開始計，
 * 所以呢個 component 用 `remaining: number | null` 做初始 state。
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CalendarPlus, Clock, MapPin } from "lucide-react";
import { BRAND, RULES } from "@/lib/config";
import { weekdayLabel } from "@/lib/utils";
import type { TrainingSession } from "@/lib/types";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 由 RULES.TRAINING_TIME（例如 "20:00 – 21:00"）抽出開始 / 結束時間 */
function trainingClock(): { start: string; end: string } {
  const times = RULES.TRAINING_TIME.match(/\d{1,2}:\d{2}/g) ?? [];
  return { start: times[0] ?? "", end: times[1] ?? "" };
}

/** 'YYYY-MM-DD' → [年, 月, 日]。逐段切分，唔用 new Date(str)（UTC parse 會差一日） */
function splitDate(value: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** 'HH:MM' → [時, 分] */
function splitClock(value: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/* ============================ F-T2：ICS ============================ */

/** RFC 5545：逗號、分號、反斜線要 escape，換行轉 \\n */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545：每行上限 75 octets（呢度用字元數做近似值），續行以一個空格起頭 */
function foldLine(line: string): string[] {
  if (line.length <= 75) return [line];
  const out: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    out.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest.length) out.push(` ${rest}`);
  return out;
}

function utcStamp(): string {
  return `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
}

/**
 * 組 ICS 字串。DTSTART / DTEND 用「浮動本地時間」（唔帶 Z、唔帶 TZID）——
 * session_date 同 TRAINING_TIME 本身就係本地時間，加時區反而會被日曆 App
 * 再轉一次；浮動時間會直接按使用者日曆時區顯示，最貼近原意。
 */
function buildIcs(session: TrainingSession, start: string, end: string): string | null {
  const d = splitDate(session.session_date);
  const s = splitClock(start);
  if (!d || !s) return null;

  const e = splitClock(end);
  const day = `${d[0]}${pad2(d[1])}${pad2(d[2])}`;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${BRAND.nameEn}//Training//ZH`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${session.id}@msw-street-workout`,
    `DTSTAMP:${utcStamp()}`,
    `DTSTART:${day}T${pad2(s[0])}${pad2(s[1])}00`,
  ];
  if (e) lines.push(`DTEND:${day}T${pad2(e[0])}${pad2(e[1])}00`);
  lines.push(`SUMMARY:${escapeText(session.title)}`);
  if (session.location) lines.push(`LOCATION:${escapeText(session.location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return `${lines.flatMap(foldLine).join("\r\n")}\r\n`;
}

/* ============================ F-T1：倒數卡 ============================ */

export function NextSessionCard({ session }: { session: TrainingSession }) {
  const { start, end } = trainingClock();

  const startMs = useMemo(() => {
    const d = splitDate(session.session_date);
    const s = splitClock(start);
    if (!d || !s) return null;
    // 明確用本地時間建 Date（逐段傳入），避免字串 parse 嘅時區偏移
    return new Date(d[0], d[1] - 1, d[2], s[0], s[1], 0, 0).getTime();
  }, [session.session_date, start]);

  // null = 仲未 mount（server / client 首次 render 完全一致，唔會 hydration mismatch）
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (startMs === null) return;

    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = () => {
      const diff = startMs - Date.now();
      setRemaining(diff > 0 ? diff : 0);
      // 倒數到 0 就收工，唔好無限輪詢
      if (diff <= 0 && timer) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    tick();
    timer = setInterval(tick, 1000);

    // cleanup：一定要清乾淨，否則 unmount 之後個 interval 會繼續跑
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [startMs]);

  const parts = splitDate(session.session_date);
  // 只用嚟攞星期（weekdayLabel 收 Date）；日期文字由上面嘅 parts 直接組，
  // 唔經 formatDate（formatDate 入面用 new Date(str) parse，純日期字串會差一日）
  const weekday = parts
    ? weekdayLabel(new Date(parts[0], parts[1] - 1, parts[2]))
    : null;

  const ms = remaining ?? 0;
  const units: { unit: string; value: number }[] = [
    { unit: "日", value: Math.floor(ms / DAY_MS) },
    { unit: "時", value: Math.floor(ms / HOUR_MS) % 24 },
    { unit: "分", value: Math.floor(ms / MINUTE_MS) % 60 },
  ];

  function handleAddToCalendar() {
    const ics = buildIcs(session, start, end);
    if (!ics) return;

    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${session.session_date}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 用完一定要 revoke，否則 blob 會一直留喺記憶體
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
  }

  return (
    <section className="clip-notch relative mb-12 overflow-hidden border border-vital/60 bg-ink-soft p-6 md:p-8">
      <div className="glow-drift pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-vital/15 blur-3xl" />

      <div className="relative grid gap-8 lg:grid-cols-12">
        {/* 場次資料：全部由 DB / RULES 提供 */}
        <div className="min-w-0 lg:col-span-5">
          <span className="eyebrow">Next Session</span>
          <h3 className="mt-4 truncate text-2xl font-black tracking-tight">
            {session.title}
          </h3>

          <div className="mt-5 space-y-2 text-sm text-white/70">
            <div className="flex items-center gap-2">
              <CalendarDays size={15} className="shrink-0 text-vital-bright" />
              <span className="tnum">
                {parts
                  ? `${parts[0]}/${pad2(parts[1])}/${pad2(parts[2])}`
                  : session.session_date}
                {weekday ? `（週${weekday}）` : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock size={15} className="shrink-0 text-vital-bright" />
              {RULES.TRAINING_TIME}
            </div>
            <div className="flex items-center gap-2">
              <MapPin size={15} className="shrink-0 text-vital-bright" />
              <span className="truncate">{session.location}</span>
            </div>
          </div>
        </div>

        {/* 倒數 + 加入日曆 */}
        <div className="lg:col-span-7 lg:border-l lg:border-white/10 lg:pl-8">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <span className="mb-2 text-sm text-white/70">仲有</span>
            {units.map((u) => (
              <div key={u.unit} className="flex items-end gap-1">
                <span className="stat-figure text-5xl leading-none text-white md:text-6xl">
                  {remaining === null ? "—" : pad2(u.value)}
                </span>
                <span className="text-accent-blue mb-1.5 text-[11px] font-semibold uppercase tracking-[0.22em]">
                  {u.unit}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-7 h-px w-16 bg-white/20" />

          <button
            type="button"
            onClick={handleAddToCalendar}
            className="btn-base btn-ghost btn-slab mt-7 min-h-11"
          >
            <CalendarPlus size={16} /> ＋加入日曆
          </button>
        </div>
      </div>
    </section>
  );
}
