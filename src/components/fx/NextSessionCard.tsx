"use client";

/**
 * F-T1 下場訓練倒數卡（Brief §2.2）
 *
 * 數據全部由 props（page 傳入的 upcoming[0]）提供：日期、時段、地點、課名都來自
 * training_sessions 那一列，唔加新 query、唔 hardcode 任何日期時間。
 * 時段讀 session.start_time / end_time（舊資料可能係 null，顯示「時間待公布」）。
 *
 * Hydration 安全：server / client 第一次 render 一律輸出同一份內容
 * （倒數位置顯示佔位符），一定要喺 useEffect（mount 後）先開始計，
 * 所以呢個 component 用 `remaining: number | null` 做初始 state。
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Clock, MapPin } from "lucide-react";
import { formatTimeRange, shortTime, weekdayLabel } from "@/lib/utils";

/**
 * 這張卡實際會用到的欄位。
 *
 * 刻意不收 TrainingSession / TrainingSessionRow 整包：
 * /training 頁面改餵 getNextSession()（NextSessionInfo），欄位剛好是這幾個。
 * 結構型別讓兩邊都能傳進來，不必為了傳參數多撈一堆用不到的欄位。
 */
export type NextSessionCardData = {
  id: string;
  session_date: string;
  title: string;
  location: string;
  start_time?: string | null;
  end_time?: string | null;
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 'YYYY-MM-DD' → [年, 月, 日]。逐段切分，唔用 new Date(str)（UTC parse 會差一日） */
function splitDate(value: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/* ============================ F-T1：倒數卡 ============================ */

export function NextSessionCard({
  session,
}: {
  session: NextSessionCardData;
  /**
   * 品牌英文名（site_theme.brand_name_en）。
   *
   * 原本是給 ICS 的 PRODID 用；ICS 下載已移除，這個 prop 因此不再有渲染作用，
   * 但**型別必須留著**——`src/app/training/page.tsx` 仍在傳它，
   * 刪掉會讓那個檔案型別爆掉（該檔不在本次改動範圍）。
   */
  brandNameEn?: string;
}) {
  // 時段一律讀這一場自己的 start_time / end_time（training_sessions），
  // 不再從 config 抽固定時間——那個值只屬於「每週固定」的介紹性文案。
  const start = shortTime(session.start_time);
  const timeText = formatTimeRange(session.start_time, session.end_time);

  const startMs = useMemo(() => {
    if (!start) return null;
    // 澳門牆上時間 + 明確 +08:00 偏移 → 絕對時刻，與瀏覽器所在時區無關
    const t = Date.parse(`${session.session_date}T${start}:00+08:00`);
    return Number.isFinite(t) ? t : null;
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

  return (
    <section className="clip-notch relative mb-12 overflow-hidden border border-vital/60 bg-ink-soft p-6 md:p-8">
      <div className="glow-drift pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-vital/15 blur-3xl" />

      <div className="relative grid gap-8 lg:grid-cols-12">
        {/* 場次資料：全部由 DB / RULES 提供 */}
        <div className="min-w-0 lg:col-span-5">
          <span className="eyebrow">Next Session</span>
          {/* 這張卡是 /training 首屏的獨立區塊，前面沒有其他 h2，
              用 h3 會出現「跳級」（h1 → h3）。改成 h2 只動標籤，字級由
              class 提供，視覺完全不變。 */}
          <h2 className="mt-4 truncate text-2xl font-black tracking-tight">
            {session.title}
          </h2>

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
              {timeText || "時間待公布"}
            </div>
            <div className="flex items-center gap-2">
              <MapPin size={15} className="shrink-0 text-vital-bright" />
              <span className="truncate">{session.location}</span>
            </div>
          </div>
        </div>

        {/* 倒數 + 馬上報名 */}
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

          {/* 站主指定：把「＋加入日曆」（ICS 下載）換成「馬上報名」，
              直接連到該場次所屬的日期頁，報名在那裡完成。 */}
          <Link
            href={`/training/${session.session_date}`}
            className="btn-base btn-vital btn-slab mt-7 min-h-11"
          >
            馬上報名 <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}
