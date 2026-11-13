/**
 * src/app/hyrox/page.tsx — MSW 戶外 HYROX 系列主頁（Server Component）
 *
 * 內容順序（依站主定稿）：
 *   1. Hero：HYROX ＋ 中文副標 ＋ 三段短介紹
 *   2. 下一場卡片（日期未定 → 顯示「日期待定」＋「開放報名後通知我」）
 *   3. 報名 CTA（未登入 / 已報名 / 未報名 三態）
 *   4. 活動資訊（訓練內容、教練、費用、天氣取消聲明）
 *   5. 往期場次（getHyroxPastEvents；沒有就整段不顯示，整張卡可點進詳情頁）
 *
 * 資料：
 *   · 下一場／活動資訊 → getHyroxEvents()（只回 published，有快取）
 *   · 往期場次 → src/components/hyrox/data.ts 的 loadPastEvents()（公開可讀）
 * 390 寬不橫向溢出：所有 flex 子項都有 min-w-0，長字串一律 break-words。
 */

import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  CalendarDays,
  Camera,
  CloudRainWind,
  Clock,
  History,
  MapPin,
  ShieldCheck,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getHyroxEvents, getMyHyroxRegistrations } from "@/lib/queries";
import { formatDate, todayISO, weekdayLabel } from "@/lib/utils";
import { publicAssetUrl } from "@/lib/assets";
import { PaymentBadge } from "@/components/hyrox/PaymentBadge";
import { loadPastEvents } from "@/components/hyrox/data";
import {
  HYROX_GROUP_OPTIONS,
  HYROX_STATIONS,
  WEATHER_NOTICE,
  eventDateValue,
  feeLabel,
  photoCountLabel,
  pickNextEvent,
} from "@/components/hyrox/shared";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "MSW 戶外 HYROX",
  description:
    "MSW 每月一次的戶外綜合體能訓練。跑步加上推雪橇、划船機、負重行走等站點，零基礎都可以參加。",
};

/** 訓練內容：HYROX 標準站點。文案移到 shared（往期詳情頁共用同一份） */

export default async function HyroxPage() {
  const profile = await getCurrentProfile();

  /**
   * 下一場：只取已上架的場次（RLS 對訪客只放行 published，走快取路徑）。
   * 往期場次另有公開查詢 loadPastEvents()——archived 對訪客不可見，
   * 靠這裡的舊寫法（includeArchived）永遠會是空的。
   */
  const events = await getHyroxEvents();
  const today = todayISO();
  const next = pickNextEvent(events, today);
  const past = await loadPastEvents();

  const mine = profile ? await getMyHyroxRegistrations(profile.id) : [];
  const myReg = next ? mine.find((r) => r.event_id === next.id) ?? null : null;

  const nextDate = eventDateValue(next?.event_date);
  const nextQr = publicAssetUrl(next?.payment_qr_path);

  return (
    <div className="pb-24 pt-24 md:pt-28">
      {/* ===== 1. Hero ===== */}
      <section className="relative overflow-hidden">
        <div className="grid-lines absolute inset-0" />
        <div className="noise-overlay" />
        <div
          className="pointer-events-none absolute -right-[18%] -top-[40%] h-[520px] w-[520px] rounded-full blur-[130px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-vital) 65%, transparent), transparent 66%)",
            opacity: 0.32,
          }}
        />

        <div className="container-msw relative z-10 pb-14 pt-10 md:pb-20 md:pt-14">
          <p className="vlabel text-white/45">Monthly Outdoor Training</p>

          <h1 className="display-xl mt-5 break-words">
            <span className="block text-white">HYROX</span>
            <span className="mt-1 block text-[0.42em] leading-tight tracking-tight">
              <span className="text-outline">戶外綜合</span>
              <span className="text-vital-bright">體能訓練</span>
            </span>
          </h1>

          <div className="mt-8 grid max-w-4xl gap-5 md:grid-cols-[1.15fr_0.85fr] md:gap-10">
            <p className="text-base leading-relaxed text-white/75">
              每月一次的戶外綜合體能訓練，把跑步同健身房搬去同一個場地：跑 1
              公里，做一站，再跑 1 公里。推雪橇、划船、負重行走，全部按你的程度分組。
            </p>
            <p className="text-base leading-relaxed text-white/60">
              零基礎都可以來。教練會先帶熱身與動作示範，第一次參加的人通常做得到，
              重點是完成，不是時間。有興趣就報名，名額有限。
            </p>
          </div>
        </div>
      </section>

      {/* ===== 2 + 3. 下一場 ＋ 報名 CTA ===== */}
      <section className="section-pad container-msw">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-2xl font-black tracking-tight md:text-3xl">
            下一場
          </h2>
          <Link
            href="/events"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-white/65 transition hover:text-white"
          >
            其他活動 <ArrowRight size={15} />
          </Link>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
          {/* 場次卡 */}
          <article className="card-dark relative overflow-hidden p-6 md:p-8">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-vital/60 via-white/20 to-transparent" />

            {next ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="slab inline-flex items-center gap-1.5 border border-vital/50 bg-vital/90 px-3 py-1 text-[11px] font-bold tracking-[0.06em] text-white">
                    <CalendarDays size={13} />
                    {nextDate
                      ? `${formatDate(nextDate)}（週${weekdayLabel(nextDate)}）`
                      : "日期待定"}
                  </span>
                  <span className="slab border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/75">
                    HYROX 系列
                  </span>
                </div>

                <h3 className="mt-4 break-words text-xl font-black leading-snug tracking-tight md:text-2xl">
                  {next.title}
                </h3>
                {next.subtitle && (
                  <p className="mt-2 break-words text-sm text-white/65">
                    {next.subtitle}
                  </p>
                )}

                <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-[var(--line-fine)] pt-5 text-sm sm:grid-cols-2">
                  <Row
                    icon={<Clock size={15} />}
                    label="時間"
                    value={
                      [next.start_time, next.end_time].filter(Boolean).join(" – ") ||
                      "待公布"
                    }
                  />
                  <Row
                    icon={<MapPin size={15} />}
                    label="地點"
                    value={next.location ?? "待公布"}
                  />
                  <Row
                    icon={<Wallet size={15} />}
                    label="費用"
                    value={feeLabel(next.fee_cents ?? 5000)}
                  />
                  <Row
                    icon={<Users size={15} />}
                    label="名額"
                    value={
                      next.capacity ? `${next.capacity} 人` : "名額不限"
                    }
                  />
                </dl>

                <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--line-fine)] pt-4 text-sm text-white/65">
                  <UserRound size={15} className="shrink-0 text-vital-bright" />
                  <span className="min-w-0 break-words">
                    教練：MSW 教練團隊
                  </span>
                  <Link
                    href="/coaches"
                    className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-vital-bright transition hover:text-white"
                  >
                    認識教練 <ArrowRight size={13} />
                  </Link>
                </div>
              </>
            ) : (
              /* 空狀態：沒有場次時不假裝有資料 */
              <div className="py-6">
                <span className="slab inline-flex items-center gap-1.5 border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-white/70">
                  <CalendarDays size={13} /> 日期待定
                </span>
                <h3 className="mt-4 text-xl font-black tracking-tight md:text-2xl">
                  下一場正在安排
                </h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-white/65">
                  日期、場地與名額確認後會在這裡公布。想第一時間知道就加入會員，
                  我們會在開放報名時通知你。
                </p>
              </div>
            )}
          </article>

          {/* 報名 CTA 三態 */}
          <aside className="card-dark flex flex-col justify-between gap-5 p-6 md:p-7">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
                Registration
              </p>

              {!profile ? (
                <>
                  <h3 className="mt-3 text-lg font-black leading-snug">
                    登入後報名
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">
                    報名要留姓名、電話同身份證後四位（作保險登記用）。登入一次，
                    之後每月報名都不用重填。
                  </p>
                </>
              ) : myReg ? (
                <>
                  <h3 className="mt-3 text-lg font-black leading-snug">
                    你已報名
                  </h3>
                  <div className="mt-3">
                    <PaymentBadge status={myReg.payment_status} />
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-white/65">
                    {myReg.payment_status === "confirmed"
                      ? "付款已確認，活動當日提早 10 分鐘到場報到。"
                      : myReg.payment_status === "rejected"
                        ? "付款證明被退回，可以重新上傳截圖再送一次。"
                        : "已收到你的轉帳截圖，管理員核對後會通知你。"}
                  </p>
                </>
              ) : (
                <>
                  <h3 className="mt-3 text-lg font-black leading-snug">
                    {nextDate ? "名額有限，額滿即止" : "開放報名後通知我"}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">
                    {nextDate
                      ? "三步完成：確認資料、睇一次免責聲明、轉帳後上傳截圖。"
                      : "日期未定，暫時未開放報名。加入會員後我們會通知你。"}
                  </p>
                </>
              )}
            </div>

            <div className="space-y-2">
              {!profile ? (
                <>
                  <Link
                    href="/login?next=/hyrox/register"
                    className="btn-base btn-vital btn-slab min-h-11 w-full"
                  >
                    登入後報名
                  </Link>
                  <Link
                    href="/signup"
                    className="btn-base btn-ghost btn-slab min-h-11 w-full"
                  >
                    還不是會員？立即加入
                  </Link>
                </>
              ) : myReg ? (
                <Link
                  href="/hyrox/register"
                  className="btn-base btn-ghost btn-slab min-h-11 w-full"
                >
                  查看我的報名
                </Link>
              ) : next && !nextDate ? (
                <Link
                  href="/dashboard"
                  className="btn-base btn-ghost btn-slab min-h-11 w-full"
                >
                  <BellRing size={16} /> 開放報名後通知我
                </Link>
              ) : next ? (
                <Link
                  href="/hyrox/register"
                  className="btn-base btn-vital btn-slab min-h-11 w-full"
                >
                  立即報名 <ArrowRight size={16} />
                </Link>
              ) : (
                <Link
                  href="/dashboard"
                  className="btn-base btn-ghost btn-slab min-h-11 w-full"
                >
                  <BellRing size={16} /> 開放報名後通知我
                </Link>
              )}
            </div>
          </aside>
        </div>
      </section>

      {/* ===== 4. 活動資訊 ===== */}
      <section className="section-pad container-msw">
        <h2 className="text-2xl font-black tracking-tight md:text-3xl">
          活動資訊
        </h2>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
          <div className="card-dark min-w-0 p-6 md:p-8">
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
                <p className="mt-2 text-xs leading-relaxed text-white/50">
                  報名時自選，教練會按當日人數微調。
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
                  教練
                </p>
                <p className="mt-2 break-words text-sm leading-relaxed text-white/70">
                  MSW 教練團隊帶熱身、動作示範與計時。全程有教練在場，
                  不適即停。
                </p>
                <Link
                  href="/coaches"
                  className="mt-2 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-vital-bright transition hover:text-white"
                >
                  教練團隊介紹 <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {/* 費用 */}
            <div className="card-dark p-6">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
                <Wallet size={14} /> 費用
              </div>
              <p className="stat-figure mt-3 break-words text-2xl font-black text-white">
                {feeLabel(next?.fee_cents ?? 5000)}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-white/60">
                轉帳後上傳截圖，管理員核對後報名才算確認。確認後加 30 積分。
              </p>
            </div>

            {/* 天氣取消聲明（凍結文案） */}
            <div className="card-dark border-l-2 border-l-amber-500/60 p-6">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-amber-300/90">
                <CloudRainWind size={14} /> 天氣安排
              </div>
              <p className="mt-3 break-words text-sm leading-relaxed text-white/75">
                {WEATHER_NOTICE}
              </p>
            </div>

            {/* 收款提示：有 QR 就顯示縮圖，沒有就老實說要問管理員 */}
            {next && (
              <div className="card-dark p-6">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
                  <ShieldCheck size={14} /> 收款碼
                </div>
                {nextQr ? (
                  <div className="mt-3 flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={nextQr}
                      alt="MSW 收款 QR Code"
                      loading="lazy"
                      decoding="async"
                      className="h-24 w-24 flex-none border border-[var(--line-fine)] bg-white object-contain p-1"
                    />
                    <p className="min-w-0 break-words text-xs leading-relaxed text-white/60">
                      報名第三步會顯示完整收款碼。也可以直接向管理員索取。
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 break-words text-xs leading-relaxed text-white/60">
                    收款碼待上架。報名前請向管理員索取收款方式。
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ===== 5. 往期場次（沒有就整段不顯示；整張卡可點進詳情頁） ===== */}
      {past.length > 0 && (
        <section className="section-pad container-msw">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="flex items-center gap-2 text-2xl font-black tracking-tight md:text-3xl">
              <History size={22} className="text-white/45" /> 往期場次
            </h2>
            <p className="text-xs text-white/50">
              按場次睇相片回顧與當日資訊
            </p>
          </div>

          <ul className="stagger mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {past.map((e) => {
              const date = eventDateValue(e.event_date);
              return (
                <li key={e.id} className="min-w-0">
                  <Link
                    href={`/hyrox/${e.id}`}
                    className="card-dark group flex min-h-11 items-center gap-3 p-4 transition hover:border-white/30 md:p-5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="stat-figure text-[11px] font-bold tracking-[0.08em] text-white/45">
                        {date
                          ? `${formatDate(date)}（週${weekdayLabel(date)}）`
                          : "日期待定"}
                      </p>
                      <p className="mt-1.5 min-w-0 break-words text-sm font-bold leading-snug text-white/90">
                        {e.title}
                      </p>
                      <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-white/55">
                        <Camera size={13} className="text-vital-bright" />
                        {photoCountLabel(e.photo_count)}
                      </p>
                    </div>
                    <ArrowRight
                      size={18}
                      className="flex-none text-white/35 transition group-hover:translate-x-0.5 group-hover:text-white/70"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/** 場次卡的一行資料（icon + label + value），value 一律可換行 */
function Row({
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
