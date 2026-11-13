/**
 * src/app/hyrox/[id]/page.tsx — 往期場次詳情頁（相片回顧）
 *
 * Server Component，公開可看、不需要登入。
 * 內容順序：標題區（日期／時間／地點／費用／狀態）→ 相片回顧 → 活動資訊 → 底部返回＋報名。
 *
 * 資料：src/components/hyrox/data.ts（後端相片查詢落地前後都能跑，見該檔註解）。
 * 邊界：沒有相片 → 「相片整理中，稍後補上」；id 不存在 → notFound()（走站內 404）。
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Camera,
  Clock,
  MapPin,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { publicAssetUrl } from "@/lib/assets";
import { formatDate, todayISO, weekdayLabel } from "@/lib/utils";
import { PhotoGallery } from "@/components/hyrox/PhotoGallery";
import { loadEventPhotos, loadPastEvent } from "@/components/hyrox/data";
import {
  HYROX_GROUP_OPTIONS,
  HYROX_STATIONS,
  eventDateValue,
  feeLabel,
} from "@/components/hyrox/shared";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

/** 場次狀態 → 徽章文字（往期詳情頁只分「已結束」與「報名中」兩種講法） */
function statusMeta(status: string, date: string | null): {
  label: string;
  className: string;
} {
  const ended =
    status === "archived" || (date !== null && date < todayISO());
  return ended
    ? {
        label: "已結束",
        className: "border-white/15 bg-white/5 text-white/55",
      }
    : {
        label: "報名中",
        className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
      };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const event = await loadPastEvent(id);
  if (!event) return { title: "找不到場次" };

  const date = eventDateValue(event.event_date);
  return {
    title: `${event.title}｜HYROX 回顧`,
    description:
      `${date ? formatDate(date) : "日期待定"} 的 MSW 戶外 HYROX 場次回顧與活動資訊。` +
      "相片、訓練內容與分組一次睇完。",
  };
}

export default async function HyroxEventDetailPage({ params }: PageProps) {
  const { id } = await params;
  const event = await loadPastEvent(id);
  if (!event) notFound();

  const photos = await loadEventPhotos(event.id);
  // 公開網址拿不到（環境未設定）就不渲染那張，不要放破圖
  const galleryPhotos = photos.flatMap((p) => {
    const url = publicAssetUrl(p.path);
    return url ? [{ id: p.id, url, caption: p.caption }] : [];
  });

  const date = eventDateValue(event.event_date);
  const badge = statusMeta(event.status, date);
  const timeText =
    [event.start_time, event.end_time].filter(Boolean).join(" – ") || "待公布";

  // 只有「已上架且未過期（或日期待定）」的場次才有報名入口
  const registerOpen =
    event.status === "published" && (date === null || date >= todayISO());

  return (
    <div className="pb-24 pt-24 md:pt-28">
      {/* ===== 標題區 ===== */}
      <section className="relative overflow-hidden">
        <div className="grid-lines absolute inset-0" />
        <div className="noise-overlay" />
        <div className="container-msw relative z-10 pb-10 pt-6 md:pb-12">
          <Link
            href="/hyrox"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-white/60 transition hover:text-white"
          >
            <ArrowLeft size={15} /> 返回 HYROX
          </Link>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="slab border border-vital/50 bg-vital/90 px-3 py-1 text-[11px] font-bold tracking-[0.06em] text-white">
              HYROX
            </span>
            <span
              className={`slab border px-3 py-1 text-[11px] font-bold ${badge.className}`}
            >
              {badge.label}
            </span>
          </div>

          <h1 className="mt-4 break-words text-2xl font-black leading-snug tracking-tight md:text-4xl">
            {event.title}
          </h1>
          {event.subtitle && (
            <p className="mt-2 break-words text-sm leading-relaxed text-white/65 md:text-base">
              {event.subtitle}
            </p>
          )}

          <dl className="mt-6 grid gap-x-6 gap-y-3 border-t border-[var(--line-fine)] pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Meta
              icon={<CalendarDays size={15} />}
              label="日期"
              value={
                date
                  ? `${formatDate(date)}（週${weekdayLabel(date)}）`
                  : "日期待定"
              }
            />
            <Meta icon={<Clock size={15} />} label="時間" value={timeText} />
            <Meta
              icon={<MapPin size={15} />}
              label="地點"
              value={event.location ?? "待公布"}
            />
            <Meta
              icon={<Wallet size={15} />}
              label="費用"
              value={feeLabel(event.fee_cents)}
            />
          </dl>
        </div>
      </section>

      {/* ===== 相片回顧 ===== */}
      <section className="section-pad container-msw">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight md:text-3xl">
            <Camera size={22} className="text-white/45" /> 相片回顧
          </h2>
          <p className="text-xs text-white/50">
            {galleryPhotos.length > 0
              ? `共 ${galleryPhotos.length} 張，點相片睇大圖`
              : "相片陸續補上"}
          </p>
        </div>

        <div className="mt-6">
          <PhotoGallery photos={galleryPhotos} />
        </div>
      </section>

      {/* ===== 活動資訊 ===== */}
      <section className="section-pad container-msw">
        <h2 className="text-2xl font-black tracking-tight md:text-3xl">
          活動資訊
        </h2>

        <div className="card-dark mt-6 min-w-0 p-6 md:p-8">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
            訓練內容
          </h3>
          <dl className="mt-4 divide-y divide-[var(--line-fine)]">
            {HYROX_STATIONS.map((s) => (
              <div
                key={s.k}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
              >
                <dt className="min-w-0 shrink-0 text-sm font-semibold text-white/85">
                  {s.k}
                </dt>
                <dd className="min-w-0 break-words text-sm text-white/60 sm:text-right">
                  {s.v}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 grid gap-4 border-t border-[var(--line-fine)] pt-5 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
                分組
              </p>
              <ul className="mt-2 space-y-1 text-sm text-white/70">
                {HYROX_GROUP_OPTIONS.map((g) => (
                  <li key={g.value} className="break-words">
                    {g.label}
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
                教練
              </p>
              <p className="mt-2 break-words text-sm leading-relaxed text-white/70">
                MSW 教練團隊帶熱身、動作示範與計時。全程有教練在場，不適即停。
              </p>
              <Link
                href="/coaches"
                className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-vital-bright transition hover:text-white"
              >
                <UserRound size={13} /> 教練團隊介紹 <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ===== 底部：返回 ＋ 報名 ===== */}
      <section className="container-msw">
        <div className="flex flex-col gap-3 border-t border-[var(--line-fine)] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/hyrox"
            className="btn-base btn-ghost btn-slab min-h-11 w-full sm:w-auto"
          >
            <ArrowLeft size={16} /> 返回 HYROX
          </Link>

          {registerOpen && (
            <Link
              // 帶上場次 id：不加參數的話報名頁會自己挑「下一場」，
              // 會員在 A 場的詳情頁按「報名這一場」就會報到 B 場。
              href={`/hyrox/register?event=${event.id}`}
              className="btn-base btn-vital btn-slab min-h-11 w-full sm:w-auto"
            >
              報名這一場 <ArrowRight size={16} />
            </Link>
          )}
        </div>

        <p className="mt-5 flex items-center gap-1.5 text-xs text-white/45">
          <Users size={13} />
          名額與報名狀態以報名頁為準。
        </p>
      </section>
    </div>
  );
}

/** 標題區的一行資料（icon + label + value），value 一律可換行 */
function Meta({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="flex-none text-vital-bright">{icon}</span>
      <dt className="flex-none text-xs uppercase tracking-[0.16em] text-white/40">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-white/80">{value}</dd>
    </div>
  );
}
