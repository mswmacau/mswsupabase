/**
 * src/app/races/page.tsx — HYROX 賽事列表（Server Component）
 *
 * 只列 status 為 open / closed / photos 的賽事（draft、archived 不列），
 * 按日期倒序。一筆都沒有 → 空狀態，不是 404（站主要求）。
 *
 * 資料來源：src/app/races/_data.ts（第一階段暫時層，第二階段換 @/lib/races）。
 */

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import { formatRaceDateCompact, listRaces } from "./_data";
import { RaceStatusPill } from "./_components/RaceStatusPill";
/* 公開頁視覺語彙（觸控 44 / 卡片三級 / 白圈 focus） */
import "../public-ui.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "HYROX 賽事",
  description: "MSW 主辦與協辦的 HYROX 賽事：日期、地點與報名狀態。",
  alternates: { canonical: "/races" },
};

export default async function RacesPage() {
  const races = await listRaces();

  return (
    <main className="pub-shell container-msw pt-24 pb-16 md:pt-32 md:pb-20">
      <div className="max-w-5xl">
        <header>
          <span className="eyebrow">HYROX</span>
          <h1 className="display-xl mt-4 text-white">賽事</h1>
        </header>

        {races.length === 0 ? (
          /* 空狀態：明確告知，不留白 */
          <div className="mt-10 border border-white/10 bg-white/[0.03] px-5 py-12 text-center">
            <p className="text-sm font-bold text-white/70">暫時未有賽事</p>
            <p className="mt-2 text-[13px] leading-relaxed text-white/45">
              有新賽事時會在這裡公佈。
            </p>
            <Link
              href="/hyrox"
              className="btn-base btn-ghost btn-slab mt-6 min-h-11 !px-5 !py-2.5 text-[13px]"
            >
              了解 HYROX
            </Link>
          </div>
        ) : (
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {races.map((race) => (
              <li key={race.id} className="min-w-0">
                <Link
                  href={`/races/${race.slug}`}
                  className="flex h-full flex-col border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-white/25 hover:bg-white/[0.06]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-vital-bright">
                      HYROX
                    </span>
                    <RaceStatusPill status={race.status} />
                  </div>

                  <h2 className="mt-2 min-w-0 break-words text-base font-bold leading-snug text-white">
                    {race.title}
                  </h2>

                  <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[12px] leading-none text-white/60">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays
                        size={13}
                        aria-hidden
                        className="flex-shrink-0"
                      />
                      <span className="tnum">
                        {formatRaceDateCompact(race)}
                      </span>
                    </span>
                    {race.location && (
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <MapPin size={13} aria-hidden className="flex-shrink-0" />
                        <span className="break-words">{race.location}</span>
                      </span>
                    )}
                  </div>

                  <span className="mt-4 inline-flex items-center gap-1 text-[12px] font-bold text-vital-bright">
                    睇詳情
                    <ArrowRight size={13} aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
