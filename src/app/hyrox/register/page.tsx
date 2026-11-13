/**
 * src/app/hyrox/register/page.tsx — HYROX 報名頁（Server 外殼）
 *
 * 職責：登入檢查、解析 `?event=`、取場次與我的報名、把資料交給 client 的 RegisterWizard。
 * 已報名的人不會再看到三步流程，只看到狀態卡（拒絕者可重交截圖）。
 *
 * `?event=` 的四種結果（resolveRequestedEvent）：
 *   None     沒有帶參數 → 與舊行為一致：pickNextEvent 取下一場
 *   Ok       帶了且是 published、未結束 → 就用這一場
 *   Ended    帶了但已結束／已封存 → 只顯示「該場次已結束」＋回顧連結，不給報名表單
 *   NotFound 帶了但找不到（亂填／草稿／已刪）→ 回退 pickNextEvent，並用一行說明
 *
 * 為什麼 Ended 與 NotFound 要分開：兩者都「不能報名」，但會員想知道的是不同的事——
 * 「我點的那場是不是結束了、去哪裡看回顧」vs「我給的連結根本不存在，那最近一場是？」
 * 一律靜默換成下一場，就會出現「在 A 場的頁面報了 B 場」這種最糟糕的結果。
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
import {
  getHyroxEventById,
  getHyroxEvents,
  getMyHyroxRegistrations,
} from "@/lib/queries";
import { formatDate, todayISO, weekdayLabelOfDate } from "@/lib/utils";
import { publicAssetUrl } from "@/lib/assets";
import { PaymentBadge } from "@/components/hyrox/PaymentBadge";
import { RegisterWizard } from "@/components/hyrox/RegisterWizard";
import { ResubmitProof } from "@/components/hyrox/ResubmitProof";
import {
  eventDateValue,
  feeLabel,
  pickNextEvent,
  type HyroxEvent,
} from "@/components/hyrox/shared";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "HYROX 報名",
  description:
    "MSW 戶外 HYROX 報名：三步完成——確認資料、閱讀免責聲明、轉帳後上傳截圖。",
};

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

type RequestedEvent =
  | { kind: "none"; event: null }
  | { kind: "ok"; event: HyroxEvent }
  | { kind: "ended"; event: HyroxEvent }
  | { kind: "notfound"; event: null };

/** 已結束 = 已封存，或日期已過。無日期（日期待定）不算結束。 */
function isEventEnded(e: HyroxEvent, today: string): boolean {
  if (e.status === "archived") return true;
  return Boolean(e.event_date) && (e.event_date as string) < today;
}

/**
 * 解析 `?event=`。看不懂的一律當 notfound，不 throw、不回 500。
 *
 * 先在「已上架清單」裡找（一次查詢就能命中絕大多數情況），找不到再單獨
 * 用 getHyroxEventById 撈一次——那支放行 archived，所以已結束的場次拿得到、
 * 可以帶會員去看回顧；draft 仍然回 null（草稿不對外）。
 */
async function resolveRequestedEvent(
  id: string,
  published: HyroxEvent[],
  today: string
): Promise<RequestedEvent> {
  if (!id) return { kind: "none", event: null };

  const hit = published.find((e) => e.id === id) ?? null;
  if (hit) {
    return isEventEnded(hit, today)
      ? { kind: "ended", event: hit }
      : { kind: "ok", event: hit };
  }

  const byId = await getHyroxEventById(id);
  if (!byId) return { kind: "notfound", event: null };

  return isEventEnded(byId, today)
    ? { kind: "ended", event: byId }
    : { kind: "ok", event: byId };
}

export default async function HyroxRegisterPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const rawEvent = Array.isArray(sp.event) ? sp.event[0] : sp.event;
  const requestedId = typeof rawEvent === "string" ? rawEvent.trim() : "";

  const profile = await getCurrentProfile();
  if (!profile) {
    // 登入後要回到「同一場」的報名頁，否則會員點 A 場、登入完變成 B 場
    const back = requestedId
      ? `/hyrox/register?event=${encodeURIComponent(requestedId)}`
      : "/hyrox/register";
    redirect(`/login?next=${encodeURIComponent(back)}`);
  }

  const today = todayISO();
  const [events, mine] = await Promise.all([
    getHyroxEvents(),
    getMyHyroxRegistrations(profile.id),
  ]);

  const next = pickNextEvent(events, today);
  const requested = await resolveRequestedEvent(requestedId, events, today);

  // 要顯示／報名的那一場：ended 時為 null（不給表單），notfound 時回退到下一場
  const target =
    requested.kind === "ok"
      ? requested.event
      : requested.kind === "ended"
        ? null
        : next;

  const endedEvent = requested.kind === "ended" ? requested.event : null;
  const endedDate = eventDateValue(endedEvent?.event_date);

  const myReg = target
    ? (mine.find((r) => r.event_id === target.id) ?? null)
    : null;

  const targetDate = eventDateValue(target?.event_date);
  const qrUrl = publicAssetUrl(target?.payment_qr_path);

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

        {/* 指定的場次已結束／已封存 → 只給回顧入口，不給報名表單 */}
        {endedEvent ? (
          <div className="card-dark mt-4 p-6 md:p-8">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">
              <Info size={14} className="flex-none" /> 已結束
            </div>
            <h2 className="mt-3 text-lg font-black tracking-tight md:text-xl">
              該場次已結束
            </h2>
            <p className="mt-2 min-w-0 break-words text-sm leading-relaxed text-white/70">
              {endedDate
                ? `${endedEvent.title} · ${formatDate(endedDate)}（週${weekdayLabelOfDate(
                    endedDate
                  )}）`
                : endedEvent.title}
            </p>
            <p className="mt-2 break-words text-sm leading-relaxed text-white/70">
              這一場已經完結，報名已關閉。
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Link
                href={`/hyrox/${endedEvent.id}`}
                className="btn-base btn-vital btn-slab min-h-11 w-full sm:w-auto"
              >
                看活動回顧
              </Link>
              <Link
                href="/hyrox"
                className="btn-base btn-ghost btn-slab min-h-11 w-full sm:w-auto"
              >
                回 HYROX 主頁
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* 找不到指定的場次 → 明確說明已回退，不靜默替換 */}
            {requested.kind === "notfound" && (
              <p
                role="status"
                className="mt-4 min-w-0 break-words border-l-2 border-amber-400/60 bg-amber-400/[0.07] px-4 py-3 text-sm leading-relaxed text-amber-100/85"
              >
                找不到你指定的場次，以下是最近一場。
              </p>
            )}

            {/* 場次摘要 */}
            {target ? (
              <div className="slab mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border border-[var(--line-fine)] bg-white/[0.03] px-4 py-3 text-sm text-white/75">
                <span className="min-w-0 break-words font-semibold text-white/90">
                  {target.title}
                </span>
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <CalendarDays size={14} className="flex-none text-vital-bright" />
                  <span className="break-words">
                    {targetDate
                      ? `${formatDate(targetDate)}（週${weekdayLabelOfDate(targetDate)}）`
                      : "日期待定"}
                  </span>
                </span>
                {(target.start_time || target.end_time) && (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Clock size={14} className="flex-none text-vital-bright" />
                    <span className="break-words">
                      {[target.start_time, target.end_time]
                        .filter(Boolean)
                        .join(" – ")}
                    </span>
                  </span>
                )}
                {target.location && (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <MapPin size={14} className="flex-none text-vital-bright" />
                    <span className="break-words">{target.location}</span>
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
            ) : target ? (
              <>
                {/* 費用提醒 */}
                <p className="mt-4 break-words text-xs leading-relaxed text-white/55">
                  費用 {feeLabel(target.fee_cents ?? 5000)}，轉帳後上傳截圖。確認付款後加
                  30 積分。
                </p>

                <div className="mt-5">
                  <RegisterWizard
                    event={{
                      id: target.id,
                      title: target.title,
                      event_date: eventDateValue(target.event_date),
                      start_time: target.start_time ?? null,
                      location: target.location ?? null,
                      fee_cents: target.fee_cents ?? null,
                      payment_phone: target.payment_phone ?? null,
                      payment_note: target.payment_note ?? null,
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
          </>
        )}
      </div>
    </div>
  );
}
