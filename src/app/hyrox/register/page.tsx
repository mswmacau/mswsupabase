/**
 * src/app/hyrox/register/page.tsx — HYROX 報名頁（Server 外殼）
 *
 * 職責：登入檢查、取場次與我的報名、把資料交給 client 的 RegisterWizard。
 * 已報名的人不會再看到三步流程，只看到狀態卡（拒絕者可重交截圖）。
 */

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  Info,
  MapPin,
} from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getHyroxEvents, getMyHyroxRegistrations } from "@/lib/queries";
import { formatDate, todayISO, weekdayLabel } from "@/lib/utils";
import { publicAssetUrl } from "@/lib/assets";
import { PaymentBadge } from "@/components/hyrox/PaymentBadge";
import { RegisterWizard } from "@/components/hyrox/RegisterWizard";
import { ResubmitProof } from "@/components/hyrox/ResubmitProof";
import { eventDateValue, feeLabel, pickNextEvent } from "@/components/hyrox/shared";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "HYROX 報名",
  description:
    "MSW 戶外 HYROX 報名：三步完成——確認資料、閱讀免責聲明、轉帳後上傳截圖。",
};

export default async function HyroxRegisterPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/hyrox/register");

  const events = await getHyroxEvents();
  const next = pickNextEvent(events, todayISO());
  const mine = await getMyHyroxRegistrations(profile.id);
  const myReg = next ? mine.find((r) => r.event_id === next.id) ?? null : null;

  const nextDate = eventDateValue(next?.event_date);
  const qrUrl = publicAssetUrl(next?.payment_qr_path);

  return (
    <div className="pb-24 pt-24 md:pt-28">
      <div className="container-msw max-w-3xl">
        <Link
          href="/hyrox"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-white/70 transition hover:text-white"
        >
          <ArrowLeft size={15} /> 回 HYROX 主頁
        </Link>

        <h1 className="mt-4 text-2xl font-black tracking-tight md:text-3xl">
          報名 MSW 戶外 HYROX
        </h1>

        {/* 場次摘要 */}
        {next ? (
          <div className="slab mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border border-[var(--line-fine)] bg-white/[0.03] px-4 py-3 text-sm text-white/75">
            <span className="min-w-0 break-words font-semibold text-white/90">
              {next.title}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <CalendarDays size={14} className="flex-none text-vital-bright" />
              <span className="break-words">
                {nextDate
                  ? `${formatDate(nextDate)}（週${weekdayLabel(nextDate)}）`
                  : "日期待定"}
              </span>
            </span>
            {(next.start_time || next.end_time) && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Clock size={14} className="flex-none text-vital-bright" />
                <span className="break-words">
                  {[next.start_time, next.end_time].filter(Boolean).join(" – ")}
                </span>
              </span>
            )}
            {next.location && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin size={14} className="flex-none text-vital-bright" />
                <span className="break-words">{next.location}</span>
              </span>
            )}
          </div>
        ) : (
          /* 空狀態：沒有任何場次可報名 */
          <div className="card-dark mt-4 p-6">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
              <Info size={14} /> 暫未開放
            </div>
            <h2 className="mt-3 text-lg font-black">這一場還未開放報名</h2>
            <p className="mt-2 break-words text-sm leading-relaxed text-white/70">
              日期或場地還在安排。開放報名後會在這裡公布，會員會收到通知。
            </p>
            <Link
              href="/hyrox"
              className="btn-base btn-ghost btn-slab mt-5 inline-flex min-h-11 w-full sm:w-auto"
            >
              回 HYROX 主頁
            </Link>
          </div>
        )}

        {/* 已報名 → 狀態卡（不給重複報名） */}
        {myReg ? (
          <section className="card-dark mt-5 p-6 md:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <CheckCircle2 size={18} className="flex-none text-emerald-300" />
              <h2 className="text-lg font-black tracking-tight">你已報名這一場</h2>
              <PaymentBadge status={myReg.payment_status} />
            </div>

            <p className="mt-3 break-words text-sm leading-relaxed text-white/70">
              {myReg.payment_status === "confirmed"
                ? "付款已確認。活動日提早 10 分鐘到場報到，出示會員頁面即可。"
                : myReg.payment_status === "rejected"
                  ? "轉帳證明被退回，請重新上傳一次截圖。"
                  : "已收到你的轉帳截圖，管理員核對後會更新狀態。"}
            </p>

            {myReg.admin_note && (
              <div className="mt-4 border-l-2 border-red-500/60 bg-red-500/10 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-300">
                  退回原因
                </p>
                <p className="mt-1 break-words text-sm leading-relaxed text-red-200">
                  {myReg.admin_note}
                </p>
              </div>
            )}

            {myReg.payment_proof_path && (
              <p className="mt-4 break-words text-xs text-white/50">
                已收到轉帳證明（管理員可查看原圖）。
              </p>
            )}

            {/* 被拒絕 → 可重交 */}
            {myReg.payment_status === "rejected" && (
              <ResubmitProof registrationId={myReg.id} />
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Link
                href="/hyrox"
                className="btn-base btn-ghost btn-slab min-h-11 w-full sm:w-auto"
              >
                回 HYROX 主頁
              </Link>
              <Link
                href="/dashboard"
                className="btn-base btn-ghost btn-slab min-h-11 w-full sm:w-auto"
              >
                我的帳戶
              </Link>
            </div>
          </section>
        ) : next ? (
          <>
            {/* 費用提醒 */}
            <p className="mt-4 break-words text-xs leading-relaxed text-white/55">
              費用 {feeLabel(next.fee_cents ?? 5000)}，轉帳後上傳截圖。確認付款後加
              30 積分。
            </p>

            <div className="mt-5">
              <RegisterWizard
                event={{
                  id: next.id,
                  title: next.title,
                  event_date: eventDateValue(next.event_date),
                  start_time: next.start_time ?? null,
                  location: next.location ?? null,
                  fee_cents: next.fee_cents ?? null,
                  payment_phone: next.payment_phone ?? null,
                  payment_note: next.payment_note ?? null,
                }}
                qrUrl={qrUrl}
                profile={{
                  full_name: profile.full_name ?? null,
                  gender: profile.gender ?? null,
                  phone: profile.phone ?? null,
                  id_last4: profile.id_last4 ?? null,
                }}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
