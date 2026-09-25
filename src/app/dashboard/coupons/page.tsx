import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Ticket } from "lucide-react";
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
    <section className="pt-28 pb-20 md:pt-36">
      <div className="container-msw">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-white/55 transition hover:text-white"
        >
          <ArrowLeft size={15} /> 回我的帳戶
        </Link>

        <div className="mt-6 max-w-2xl">
          <span className="eyebrow">My Coupons</span>
          <h1 className="section-title mt-4">我的優惠券</h1>
          <p className="mt-4 leading-relaxed text-white/60">
            月度任務達標後由後台發放，出示 QR Code 或券碼即可在 MSW 街健館兌換。
          </p>
        </div>

        <div className="mt-10">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Ticket size={18} className="text-vital" /> 可使用（{active.length}）
          </h2>

          <div className="mt-5 grid gap-5 md:grid-cols-2">
            {active.length ? (
              active.map((c) => <CouponCard key={c.id} coupon={c} />)
            ) : (
              <div className="rounded-2xl border border-dashed border-white/15 px-6 py-14 text-center md:col-span-2">
                <div className="text-4xl">🎟️</div>
                <p className="mt-4 text-sm text-white/50">
                  目前沒有可使用的優惠券。完成當月 {RULES.MONTHLY_GOAL_KM}{" "}
                  公里跑步任務即可獲得。
                </p>
                <Link href="/run" className="btn-base btn-vital mt-6">
                  上傳跑步紀錄
                </Link>
              </div>
            )}
          </div>
        </div>

        {used.length > 0 && (
          <div className="mt-12">
            <h2 className="text-lg font-bold text-white/70">
              已使用 / 已失效（{used.length}）
            </h2>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
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
