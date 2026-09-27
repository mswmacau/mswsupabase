import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Ticket } from "lucide-react";
import { CouponCard } from "@/components/CouponCard";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getUserCoupons } from "@/lib/queries";
import { RULES } from "@/lib/config";

export const metadata = { title: "我的優惠券" };
export const dynamic = "force-dynamic";

export default async function CouponsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/dashboard/coupons");

  const coupons = await getUserCoupons(profile.id);
  const active = coupons.filter((c) => c.status === "active");
  const used = coupons.filter((c) => c.status !== "active");

  return (
    <section className="relative overflow-hidden pb-20 pt-24 md:pt-28">
      {/* 單側光暈（只在左上，刻意不對稱） */}
      <div
        className="pointer-events-none absolute -left-[15%] -top-[28%] h-[520px] w-[520px] rounded-full blur-[130px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--color-vital) 62%, transparent), transparent 66%)",
          opacity: 0.28,
        }}
      />
      <div className="grid-lines absolute inset-0" />
      <div className="noise-overlay" />

      <div className="container-msw relative z-10">
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-white/70 transition hover:text-white"
        >
          <ArrowLeft size={15} /> 回我的帳戶
        </Link>

        {/* 標題：宣言式大字 */}
        <div className="mt-6 flex gap-6">
          <span className="vlabel hidden shrink-0 text-white/40 lg:block">
            My Coupons
          </span>
          <div className="min-w-0 flex-1">
            <span className="eyebrow">Redeem Rewards</span>
            <h1 className="display-xl mt-6">
              <span className="block text-white">我的</span>
              <span className="mt-1 block">
                <span className="text-outline">優惠</span>
                <span className="text-vital-bright">券</span>
              </span>
            </h1>
            <p className="mt-8 max-w-xl text-base leading-relaxed text-white/70">
              月度任務達標後由後台發放，出示 QR Code 或券碼即可在 MSW 街健館兌換。
            </p>
          </div>
        </div>

        {/* 可使用 */}
        <div className="mt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--line-fine)] pb-4">
            <h2 className="flex items-center gap-2 text-lg font-black tracking-tight">
              <Ticket size={18} className="text-vital-bright" /> 可使用
            </h2>
            <span className="stat-figure text-2xl text-vital-bright">
              {active.length}
              <span className="ml-1 font-sans text-xs font-medium text-white/55">
                張
              </span>
            </span>
          </div>

          <div className="stagger mt-6 grid gap-5 md:grid-cols-2">
            {active.length ? (
              active.map((c) => <CouponCard key={c.id} coupon={c} />)
            ) : (
              <div className="clip-notch-br border border-dashed border-white/15 px-6 py-14 text-center md:col-span-2">
                <span className="mx-auto flex h-12 w-12 items-center justify-center border border-[var(--line-fine)] text-vital-bright">
                  <Ticket size={22} />
                </span>
                <p className="mt-5 text-sm text-white/70">
                  目前沒有可使用的優惠券。完成當月 {RULES.MONTHLY_GOAL_KM}{" "}
                  公里跑步任務即可獲得。
                </p>
                <Link href="/run" className="btn-base btn-vital btn-slab mt-6 min-h-11">
                  上傳跑步紀錄 <ArrowRight size={16} />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* 已使用 / 已失效 */}
        {used.length > 0 && (
          <div className="mt-14">
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--line-fine)] pb-4">
              <h2 className="text-lg font-black tracking-tight text-white/70">
                已使用 / 已失效
              </h2>
              <span className="stat-figure text-2xl text-white/60">
                {used.length}
                <span className="ml-1 font-sans text-xs font-medium text-white/45">
                  張
                </span>
              </span>
            </div>
            <div className="stagger mt-6 grid gap-5 md:grid-cols-2">
              {used.map((c) => (
                <CouponCard key={c.id} coupon={c} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
