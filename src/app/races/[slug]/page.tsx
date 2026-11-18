/**
 * src/app/races/[slug]/page.tsx — 單場 HYROX 賽事公開頁（Server Component）
 *
 * 狀態機（資料來自 events.status，賽事以 series='race' 標記）：
 *   open     → 報名資訊 ＋「報名」按鈕（/races/[slug]/register）
 *   closed   → 「報名已截止」＋ 交通住宿說明（不顯示報名按鈕）
 *   photos   → 大按鈕「睇比賽相片」（外鏈新視窗，站內不嵌圖）
 *   draft / archived → notFound()
 *
 * 文案規則：頁面骨架用中性文字（日程與組別／交通與住宿／費用說明／注意事項），
 *   賽事名稱、日期、地點、組別名、費用、注意事項全部來自資料庫，
 *   這裡不發明任何賽事內容。
 *
 * 隱私紅線：本頁只渲染彙總數字（人數／人次／座位數），
 *   不存在姓名、email、電話、user_id。資料層 src/app/races/_data.ts
 *   只白名單 select 彙總欄位，拿不到就整塊隱藏（絕不顯示 0）。
 *
 * 手機 390 為設計基準；桌面才把「日程與組別」分成三欄。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  Bus,
  CalendarDays,
  Camera,
  ChevronLeft,
  ClipboardList,
  ExternalLink,
  Info,
  MapPin,
  Route,
  Users,
  Wallet,
} from "lucide-react";
import { formatRaceDate, getRace } from "../_data";
import { RaceStatusPill } from "../_components/RaceStatusPill";
/* 公開頁視覺語彙（觸控 44 / 卡片三級 / 白圈 focus） */
import "../../public-ui.css";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

/* =====================================================================
 * 小工具
 * ===================================================================== */

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** "2026-11-20" → "11 月 20 日 · 週五"（用手動解析，不經時區轉換） */
function dayLabel(iso: string): string {
  const hit = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!hit) return iso;
  const y = Number(hit[1]);
  const m = Number(hit[2]);
  const d = Number(hit[3]);
  const weekday = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m} 月 ${d} 日 · 週${weekday}`;
}

/** 區塊抬頭（骨架文字，內容全部由資料庫來） */
function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-10 border-t border-white/10 pt-6 md:mt-12 md:pt-8">
      <h2 className="flex items-center gap-2 text-sm font-bold text-white/50">
        <span className="flex-shrink-0" aria-hidden>
          {icon}
        </span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** 自由文字區塊：保留後台輸入的換行，長英文字串不撐破容器 */
function FreeText({ text }: { text: string }) {
  return (
    <p className="max-w-3xl whitespace-pre-line break-words text-[15px] leading-relaxed text-white/75">
      {text}
    </p>
  );
}

/* =====================================================================
 * Metadata
 * ===================================================================== */

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const race = await getRace(slug);

  // 沒有賽事（不存在 / draft / archived）→ noindex
  if (!race) {
    return {
      title: "找不到賽事",
      robots: { index: false, follow: false },
    };
  }

  const dateLabel = formatRaceDate(race);
  const place = race.location ?? "";
  return {
    title: [race.title, dateLabel, place].filter(Boolean).join("｜"),
    description: `HYROX 賽事：${race.title}，${dateLabel}${
      place ? `，${place}` : ""
    }。`,
    alternates: { canonical: `/races/${race.slug}` },
    openGraph: {
      title: race.title,
      description: `${dateLabel}${place ? ` · ${place}` : ""}`,
    },
  };
}

/* =====================================================================
 * 頁面
 * ===================================================================== */

export default async function RacePage({ params }: PageProps) {
  const { slug } = await params;
  const race = await getRace(slug);
  if (!race) notFound();

  const dateLabel = formatRaceDate(race);
  const stats = race.stats;
  const feeText = race.feeNote ?? race.body;

  return (
    <main className="pub-shell container-msw pt-24 pb-16 md:pt-32 md:pb-20">
      <div className="max-w-5xl">
        {/* 返回：與列表頁互為一對 */}
        <Link
          href="/races"
          className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-white/50 transition-colors hover:text-white"
        >
          <ChevronLeft size={16} aria-hidden />
          所有賽事
        </Link>

        {/* 1. 標題區 */}
        <header className="mt-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="eyebrow">HYROX</span>
            <RaceStatusPill status={race.status} />
          </div>

          <h1 className="display-xl mt-4 break-words text-white">{race.title}</h1>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-white/65">
            {dateLabel && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={15} aria-hidden className="flex-shrink-0" />
                <span className="tnum">{dateLabel}</span>
              </span>
            )}
            {race.location && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin size={15} aria-hidden className="flex-shrink-0" />
                <span className="break-words">{race.location}</span>
              </span>
            )}
          </div>
        </header>

        {/* 2. 摘要數字：只讀彙總，拿不到整塊不顯示（絕不顯示 0） */}
        {stats && (
          <dl className="mt-8 grid grid-cols-3 gap-2.5 sm:gap-3">
            {stats.registered !== null && (
              <div className="border border-white/10 bg-white/[0.03] px-3 py-3">
                <dt className="flex items-center gap-1.5 text-[11px] text-white/50">
                  <Users size={12} aria-hidden className="flex-shrink-0" />
                  報名人數
                </dt>
                <dd className="tnum mt-1 text-xl font-black leading-none text-white sm:text-2xl">
                  {stats.registered}
                </dd>
              </div>
            )}
            {stats.totalEntries !== null && (
              <div className="border border-white/10 bg-white/[0.03] px-3 py-3">
                <dt className="flex items-center gap-1.5 text-[11px] text-white/50">
                  <Route size={12} aria-hidden className="flex-shrink-0" />
                  總人次
                </dt>
                <dd className="tnum mt-1 text-xl font-black leading-none text-white sm:text-2xl">
                  {stats.totalEntries}
                </dd>
              </div>
            )}
            {stats.busSeats !== null && (
              <div className="border border-white/10 bg-white/[0.03] px-3 py-3">
                <dt className="flex items-center gap-1.5 text-[11px] text-white/50">
                  <Bus size={12} aria-hidden className="flex-shrink-0" />
                  巴士座位
                </dt>
                <dd className="tnum mt-1 text-xl font-black leading-none text-white sm:text-2xl">
                  {stats.busSeats}
                </dd>
              </div>
            )}
          </dl>
        )}

        {/* 3. 日程與組別：手機分行清單、桌面三欄 */}
        {race.schedule && race.schedule.length > 0 && (
          <Section title="日程與組別" icon={<CalendarDays size={15} />}>
            <div className="grid gap-3 lg:grid-cols-3">
              {race.schedule.map((day) => (
                <div
                  key={day.date}
                  className="border border-white/10 bg-white/[0.03] px-3.5 py-3"
                >
                  <p className="tnum text-[12px] font-bold tracking-wide text-vital-bright">
                    {dayLabel(day.date)}
                  </p>
                  <ul className="mt-2 divide-y divide-white/5">
                    {day.divisions.map((d) => (
                      <li
                        key={`${day.date}-${d.name}`}
                        className="flex items-baseline justify-between gap-3 py-1.5"
                      >
                        <span className="min-w-0 break-words text-[13px] text-white/80">
                          {d.name}
                        </span>
                        <span className="tnum flex-shrink-0 text-[13px] font-bold text-white">
                          {d.count} 人
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* 4. 交通與住宿（closed 狀態也要看得到） */}
        {race.logisticsNote && (
          <Section title="交通與住宿" icon={<Bus size={15} />}>
            <FreeText text={race.logisticsNote} />
          </Section>
        )}

        {/* 5. 費用說明 */}
        {feeText && (
          <Section title="費用說明" icon={<Wallet size={15} />}>
            <FreeText text={feeText} />
          </Section>
        )}

        {/* 6. 注意事項 */}
        {race.notice && (
          <Section title="注意事項" icon={<Info size={15} />}>
            <FreeText text={race.notice} />
          </Section>
        )}

        {/* 7. 底部 CTA：依狀態切換 */}
        <div className="mt-12 border-t border-white/10 pt-8">
          {race.status === "open" && (
            <>
              <Link
                href={`/races/${race.slug}/register`}
                className="btn-base btn-vital btn-slab pub-press min-h-12 w-full !px-6 !py-3.5 text-[15px] sm:w-auto"
              >
                報名 <ArrowRight size={18} aria-hidden />
              </Link>
              <p className="mt-4 flex items-center gap-1.5 text-[12px] text-white/45">
                <ClipboardList size={13} aria-hidden className="flex-shrink-0" />
                名額與組別以報名頁為準。
              </p>
            </>
          )}

          {race.status === "closed" && (
            <p className="inline-flex items-center gap-2 border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-white/70">
              <Info size={16} aria-hidden className="flex-shrink-0" />
              報名已截止
            </p>
          )}

          {race.status === "photos" && race.albumUrl && (
            <a
              href={race.albumUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-base btn-vital btn-slab pub-press min-h-12 w-full !px-6 !py-3.5 text-[15px] sm:w-auto"
            >
              <Camera size={18} aria-hidden />
              {race.albumLabel ?? "睇比賽相片"}
              <ExternalLink size={15} aria-hidden />
              <span className="sr-only">（另開新視窗）</span>
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
