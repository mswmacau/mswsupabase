import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SignupForm } from "./SignupForm";
import { getCurrentProfile } from "@/lib/supabase/server";
import { RULES } from "@/lib/config";

export const metadata = { title: "註冊會員" };

export default async function SignupPage() {
  const profile = await getCurrentProfile();
  if (profile) redirect("/dashboard");

  return (
    <section className="relative min-h-[calc(100vh-4rem)] overflow-hidden pt-28 pb-20">
      <div className="hero-grid absolute inset-0 opacity-40" />
      <div
        className="pointer-events-none absolute left-1/2 top-10 h-[420px] w-[420px] -translate-x-1/2 rounded-full blur-[120px]"
        style={{
          background: "radial-gradient(circle, rgba(227,0,27,0.4), transparent 65%)",
        }}
      />

      <div className="container-msw relative">
        <div className="mx-auto w-full max-w-md">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-white/55 transition hover:text-white"
          >
            <ArrowLeft size={15} /> 回首頁
          </Link>

          <div className="card-dark p-8">
            <div className="mb-7 text-center">
              <span className="eyebrow">Join MSW</span>
              <h1 className="mt-3 text-3xl font-black">註冊會員</h1>
              <p className="mt-2 text-sm text-white/50">
                免費加入，立即開始累積里程與積分
              </p>
            </div>

            <SignupForm />

            <div className="mt-8 rounded-xl border border-ink-line bg-black/20 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-white/40">
                會員權益
              </div>
              <ul className="mt-3 space-y-2 text-sm text-white/65">
                <li>· 訓練簽到每次 +{RULES.CHECKIN_POINTS} 積分</li>
                <li>· 跑步每公里 +{RULES.POINTS_PER_KM} 積分</li>
                <li>
                  · 每月滿 {RULES.MONTHLY_GOAL_KM}km 額外 +
                  {RULES.MONTHLY_BONUS_POINTS} 分並獲優惠券
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
