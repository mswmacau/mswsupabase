/**
 * src/app/races/[slug]/register/page.tsx — 報名入口（第一階段佔位頁）
 *
 * ⚠️ 這一頁只是為了不讓詳情頁的「報名」按鈕變成死鏈（404）。
 *   報名流程（實名資料、付款截圖、免責聲明、名額與組別）屬於第二階段，
 *   由後端／產品線提供後再接手；本頁**刻意不做任何假成功表單**，
 *   也不寫入任何資料，避免站主誤以為報名已可用。
 *
 * 賽事不存在 / draft / archived → notFound()（與詳情頁一致）。
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Info } from "lucide-react";
import { formatRaceDate, getRace } from "../../_data";
import { RaceStatusPill } from "../../_components/RaceStatusPill";
/* 公開頁視覺語彙（觸控 44 / 白圈 focus） */
import "../../../public-ui.css";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const race = await getRace(slug);
  return {
    title: race ? `報名｜${race.title}` : "找不到賽事",
    // 佔位頁，不進搜尋結果
    robots: { index: false, follow: false },
  };
}

export default async function RaceRegisterPage({ params }: PageProps) {
  const { slug } = await params;
  const race = await getRace(slug);
  if (!race) notFound();

  const dateLabel = formatRaceDate(race);

  return (
    <main className="pub-shell container-msw pt-24 pb-16 md:pt-32 md:pb-20">
      <div className="max-w-2xl">
        <Link
          href={`/races/${race.slug}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-white/50 transition-colors hover:text-white"
        >
          <ChevronLeft size={16} aria-hidden />
          返回賽事
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="eyebrow">HYROX</span>
          <RaceStatusPill status={race.status} />
        </div>

        <h1 className="display-xl mt-4 break-words text-white">{race.title}</h1>

        {dateLabel && (
          <p className="tnum mt-3 text-[13px] text-white/60">{dateLabel}</p>
        )}

        <div className="mt-8 border border-white/10 bg-white/[0.03] px-4 py-5">
          <p className="flex items-center gap-2 text-sm font-bold text-white/80">
            <Info size={16} aria-hidden className="flex-shrink-0" />
            報名功能開發中
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-white/55">
            這一場的網上報名尚未開放。賽事資訊以賽事頁為準，開放後會在這裡公佈。
          </p>
        </div>
      </div>
    </main>
  );
}
