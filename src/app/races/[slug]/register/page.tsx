/**
 * src/app/races/[slug]/register/page.tsx — 賽事報名（會員端）
 *
 * Server Component：只負責「能不能填、用哪一種模式、把資料交給表單」，
 * 所有互動（分步、toggle、上載、提交）在 _components/RaceRegisterForm.tsx。
 *
 * 四種入場狀態（互斥）：
 *   1. 未登入              → 登入引導（帶 ?next= 回本頁），不自動跳走
 *   2. 已登入未報名        → 表單（新增）
 *   3. 已登入已報名        → 表單（修改，預填）
 *   4. 已報名但已取消      → 狀態卡（後端 PATCH 會 409，不給表單）
 *   另有：賽事已截止（status !== 'open'）→ 唯讀內容 + 說明（不給表單）
 *
 * 資料來源：
 *   · getRace(slug)                公開頁資料層（draft/archived → notFound）
 *   · getRaceCategories(eventId)   @/lib/races（唯讀引用）
 *   · getMyRaceRegistrations(uid)  @/lib/races（本人那一筆）
 *   · getRaceRegisterMeta(eventId) 本模組 _data.ts 新增（賽事層費用＋收款碼）
 *
 * 隱私：本頁只讀「登入者自己」的報名（查詢以 user_id 過濾，RLS 亦只放行本人）。
 * 付款：只顯示收款碼與上載入口，不做金額合計、不代收、不跳轉支付。
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle, ChevronLeft, LockKeyhole } from "lucide-react";
import type { MyRaceRegistration, RaceCategory } from "@/lib/types";
import {
  formatRaceDate,
  getRace,
  getRaceRegisterMeta,
  type Race,
} from "../../_data";
import { RaceStatusPill } from "../../_components/RaceStatusPill";
import {
  RaceRegisterForm,
  type RegisterCategory,
  type RegisterInitial,
} from "../../_components/RaceRegisterForm";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getMyRaceRegistrations, getRaceCategories } from "@/lib/races";
import { publicAssetUrl } from "@/lib/assets";
/* 公開頁視覺語彙（觸控 44 / 白圈 focus） */
import "../../../public-ui.css";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** "2026-11-20" → "11 月 20 日 · 週五"（手動解析，不經時區轉換） */
function dayLabel(iso: string): string {
  const hit = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!hit) return iso;
  const y = Number(hit[1]);
  const m = Number(hit[2]);
  const d = Number(hit[3]);
  const weekday = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m} 月 ${d} 日 · 週${weekday}`;
}

/** 報名狀態 → 前台用字（與會員中心那張卡同一套口徑） */
const REG_STATUS_LABEL: Record<string, string> = {
  submitted: "待教練確認",
  confirmed: "已確認",
  needs_info: "需補資料",
  cancelled: "已取消",
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const race = await getRace(slug);
  return {
    title: race ? `報名｜${race.title}` : "找不到賽事",
    // 報名頁屬會員功能，不進搜尋結果
    robots: { index: false, follow: false },
  };
}

export default async function RaceRegisterPage({ params }: PageProps) {
  const { slug } = await params;
  const race = await getRace(slug);
  if (!race) notFound();

  const profile = await getCurrentProfile();
  const dateLabel = formatRaceDate(race);

  /* --- 1. 未登入：登入引導（不自動 redirect） --- */
  if (!profile) {
    const next = `/races/${race.slug}/register`;
    return (
      <Shell race={race} dateLabel={dateLabel}>
        <div className="card-dark mt-6 p-5 md:p-7">
          <div className="flex items-center gap-2">
            <LockKeyhole
              size={18}
              aria-hidden
              className="flex-shrink-0 text-vital-bright"
            />
            <h2 className="text-lg font-black tracking-tight text-white">
              請先登入
            </h2>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-white/65">
            登入後即可報名這場賽事，之後也可以在會員中心查看與修改。
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Link
              href={`/login?next=${encodeURIComponent(next)}`}
              className="btn-base btn-vital btn-slab min-h-11 w-full text-sm sm:w-auto"
            >
              登入
            </Link>
            <Link
              href={`/races/${race.slug}`}
              className="btn-base btn-ghost btn-slab min-h-11 w-full text-sm sm:w-auto"
            >
              返回賽事頁
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  /* --- 已登入：取組別＋自己的報名＋付款資訊 --- */
  const [categories, mine, meta] = await Promise.all([
    getRaceCategories(race.id),
    getMyRaceRegistrations(profile.id),
    getRaceRegisterMeta(race.id),
  ]);

  const registration = mine.find((r) => r.event_id === race.id) ?? null;
  const qrUrl = publicAssetUrl(meta.paymentQrPath);

  /* --- 4. 已取消 --- */
  if (registration && registration.status === "cancelled") {
    return (
      <Shell race={race} dateLabel={dateLabel}>
        <RegistrationSummary
          title="這筆報名已取消"
          tone="muted"
          categories={categories}
          registration={registration}
        >
          <p className="mt-3 text-sm leading-relaxed text-white/65">
            如需重新報名，請聯絡教練。
          </p>
        </RegistrationSummary>
      </Shell>
    );
  }

  /* --- 已截止（含截止時間已過：_data.ts 已把 open 轉成 closed） --- */
  if (race.status !== "open") {
    return (
      <Shell race={race} dateLabel={dateLabel}>
        <div className="mt-6 border-l-2 border-amber-400/60 bg-amber-400/[0.07] px-4 py-3">
          <p className="flex items-start gap-2 text-sm font-bold text-amber-100/90">
            <AlertCircle size={16} aria-hidden className="mt-0.5 flex-shrink-0" />
            <span className="min-w-0 break-words">報名已截止</span>
          </p>
          <p className="mt-1 pl-6 text-[13px] leading-relaxed text-amber-100/75">
            {registration
              ? "以下是你已提交的報名內容（唯讀）。如需取消或修改，請聯絡教練。"
              : "這場賽事已不接受報名，賽事資訊以賽事頁為準。"}
          </p>
        </div>

        {registration && (
          <RegistrationSummary
            title="你的報名內容"
            tone="plain"
            categories={categories}
            registration={registration}
          />
        )}

        <Link
          href={`/races/${race.slug}`}
          className="btn-base btn-ghost btn-slab mt-5 min-h-11 w-full text-sm sm:w-auto"
        >
          返回賽事頁
        </Link>
      </Shell>
    );
  }

  /* --- 2 / 3. 表單（新增或修改） --- */
  const formCategories: RegisterCategory[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    day: c.day,
    team_size: c.team_size,
    fee_cents: c.fee_cents,
  }));

  const profileGender =
    profile.gender === "male" || profile.gender === "female"
      ? profile.gender
      : null;
  const regGender =
    registration?.gender === "male" || registration?.gender === "female"
      ? registration.gender
      : null;

  const initial: RegisterInitial = {
    full_name: registration?.full_name ?? profile.full_name ?? "",
    phone: registration?.phone ?? profile.phone ?? "",
    gender: regGender ?? profileGender,
    needs_bus: registration?.needs_bus ?? false,
    bus_seats: registration?.bus_seats ?? 1,
    needs_lodging: registration?.needs_lodging ?? false,
    lodging_people: registration?.lodging_people ?? 1,
    lodging_nights: registration?.lodging_nights ?? 1,
    member_note: registration?.member_note ?? "",
    entries: (registration?.entries ?? []).map((e) => ({
      category_id: e.category_id,
      teammate_names: e.teammate_names,
    })),
    hasProof: Boolean(registration?.payment_proof_path),
  };

  return (
    <Shell race={race} dateLabel={dateLabel}>
      <h2 className="mt-6 text-base font-black text-white">
        {registration ? "修改報名" : "新增報名"}
      </h2>
      {registration && (
        <p className="mt-1 text-[13px] leading-relaxed text-white/60">
          目前狀態：
          <span className="font-semibold text-white/80">
            {REG_STATUS_LABEL[registration.status] ?? registration.status}
          </span>
          <span className="mx-1.5 text-white/30">·</span>
          修改後會回到「待教練確認」。
        </p>
      )}
      {registration?.admin_note && (
        <div className="mt-3 border-l-2 border-red-500/60 bg-red-500/10 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-300">
            教練備註
          </p>
          <p className="mt-1 break-words text-sm leading-relaxed text-red-200">
            {registration.admin_note}
          </p>
        </div>
      )}

      <RaceRegisterForm
        eventId={race.id}
        eventSlug={race.slug}
        eventTitle={race.title}
        mode={registration ? "edit" : "create"}
        categories={formCategories}
        initial={initial}
        feeCents={meta.feeCents}
        qrUrl={qrUrl}
      />
    </Shell>
  );
}

/* =====================================================================
 * 版面外殼（標題區，四種狀態共用）
 * ===================================================================== */

function Shell({
  race,
  dateLabel,
  children,
}: {
  race: Race;
  dateLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="pub-shell container-msw pt-24 pb-16 md:pt-32 md:pb-20">
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

        {children}
      </div>
    </div>
  );
}

/* =====================================================================
 * 唯讀報名摘要（已截止／已取消）
 * ===================================================================== */

function RegistrationSummary({
  title,
  tone,
  categories,
  registration,
  children,
}: {
  title: string;
  tone: "plain" | "muted";
  categories: RaceCategory[];
  registration: MyRaceRegistration;
  children?: ReactNode;
}) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const items = registration.entries.map((e) => {
    const hit = e.category ?? byId.get(e.category_id) ?? null;
    return {
      key: `${e.category_id}-${e.teammate_names ?? ""}`,
      label: hit?.name ?? "組別資料暫不可用",
      day: hit?.day ?? null,
      mate: e.teammate_names,
    };
  });

  return (
    <div
      className={`card-dark mt-5 p-5 md:p-7 ${tone === "muted" ? "opacity-80" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-black text-white">{title}</h2>
        <span className="inline-flex flex-shrink-0 items-center rounded-full border border-white/20 px-2.5 py-1 text-[11px] font-bold text-white/70">
          {REG_STATUS_LABEL[registration.status] ?? registration.status}
        </span>
      </div>

      <dl className="mt-4 space-y-2.5 border-t border-white/10 pt-4 text-sm">
        <Row label="姓名">{registration.full_name}</Row>
        <Row label="電話">{registration.phone}</Row>
        <Row label="性別">
          {registration.gender === "male"
            ? "男"
            : registration.gender === "female"
              ? "女"
              : "—"}
        </Row>
        <div className="flex gap-3">
          <dt className="w-16 flex-shrink-0 text-white/50">參賽項目</dt>
          <dd className="min-w-0 flex-1 space-y-1">
            {items.length === 0 ? (
              <span className="text-white/60">—</span>
            ) : (
              items.map((it) => (
                <div key={it.key} className="min-w-0">
                  <span className="break-words text-white/85">{it.label}</span>
                  {it.day && (
                    <span className="tnum ml-1.5 text-xs text-white/45">
                      {dayLabel(it.day)}
                    </span>
                  )}
                  {it.mate && (
                    <span className="mt-0.5 block break-words text-xs text-white/50">
                      隊友：{it.mate}
                    </span>
                  )}
                </div>
              ))
            )}
          </dd>
        </div>
        <Row label="巴士">
          {registration.needs_bus ? `${registration.bus_seats} 位` : "不需要"}
        </Row>
        <Row label="住宿">
          {registration.needs_lodging
            ? `${registration.lodging_people} 人 ${registration.lodging_nights} 晚`
            : "不需要"}
        </Row>
        {registration.member_note && (
          <Row label="備註">{registration.member_note}</Row>
        )}
      </dl>

      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-16 flex-shrink-0 text-white/50">{label}</dt>
      <dd className="min-w-0 break-words text-white/85">{children}</dd>
    </div>
  );
}
