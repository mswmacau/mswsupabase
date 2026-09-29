import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SignupForm } from "./SignupForm";
import { getCurrentProfile } from "@/lib/supabase/server";
import { RULES } from "@/lib/config";

export const metadata = { title: "註冊會員" };

/** 左側宣言區的三聯事實 */
const FACTS = [
  { value: `+${RULES.POINTS_PER_KM}`, unit: "pt / km", label: "每公里入帳" },
  { value: `+${RULES.CHECKIN_POINTS}`, unit: "pts", label: "訓練簽到一次" },
  { value: `+${RULES.MONTHLY_BONUS_POINTS}`, unit: "pts", label: "月度達標獎勵" },
] as const;

/** 會員權益：節奏式排版 */
const BENEFITS = [
  { k: "訓練簽到", v: `每次 +${RULES.CHECKIN_POINTS} 積分` },
  { k: "跑步里程", v: `每公里 +${RULES.POINTS_PER_KM} 積分` },
  {
    k: "月度任務",
    v: `滿 ${RULES.MONTHLY_GOAL_KM}km 額外 +${RULES.MONTHLY_BONUS_POINTS} 分並獲優惠券`,
  },
] as const;

export default async function SignupPage() {
  const profile = await getCurrentProfile();
  if (profile) redirect("/dashboard");

  // min-h-screen-safe：微信／iOS Safari 改用 svh，避免網址列遮住底部（定義見 globals.css）
  return (
    <section className="relative min-h-screen-safe overflow-hidden pb-20 pt-24 md:pt-28">
      {/* 單側光暈（只在左上，刻意與登入頁相反） */}
      <div
        className="pointer-events-none absolute -left-[15%] -top-[28%] h-[560px] w-[560px] rounded-full blur-[130px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--color-vital) 70%, transparent), transparent 66%)",
          opacity: 0.34,
        }}
      />
      {/* 右下用幾何色塊平衡，避免左右對稱 */}
      <div className="clip-notch-br pointer-events-none absolute -bottom-16 -right-24 h-64 w-64 bg-cobalt/10" />

      {/* 手工質感：細網格 + 噪點 */}
      <div className="grid-lines absolute inset-0" />
      <div className="noise-overlay" />

      <div className="container-msw relative z-10">
        {/* 不對稱分欄：左敘事 / 右表單 */}
        <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          {/* ===== 左：宣言式大字 ===== */}
          <div className="flex gap-6 lg:pt-4">
            <span className="vlabel hidden shrink-0 text-white/40 lg:block">
              No Excuses
            </span>

            <div className="min-w-0 flex-1">
              <Link
                href="/"
                className="inline-flex min-h-11 items-center gap-1.5 text-sm text-white/70 transition hover:text-white"
              >
                <ArrowLeft size={15} /> 回首頁
              </Link>

              <span className="eyebrow mt-8 block">Join MSW</span>

              <h1 className="display-xl mt-6">
                <span className="block text-white">開始</span>
                <span className="mt-1 block">
                  <span className="text-outline">累積</span>
                  <span className="text-vital-bright">你的里程</span>
                </span>
              </h1>

              <p className="mt-8 max-w-md text-base leading-relaxed text-white/70">
                免費加入 MSW 街健館。每週一定期訓練、每月{" "}
                {RULES.MONTHLY_GOAL_KM} 公里跑步挑戰，
                里程與簽到都由後台確認後入帳，讓訓練變成看得見的累積。
              </p>

              <dl className="stagger mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-[var(--line-fine)] pt-6">
                {FACTS.map((f) => (
                  <div key={f.label}>
                    <dt className="stat-figure text-3xl text-white">
                      {f.value}
                      <span className="ml-1 text-xs font-semibold tracking-normal text-white/50">
                        {f.unit}
                      </span>
                    </dt>
                    <dd className="mt-2 text-[11px] uppercase tracking-[0.18em] text-white/50">
                      {f.label}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {/* ===== 右：表單 + 會員權益 ===== */}
          <div className="clip-notch-br border border-[var(--line-fine)] bg-[var(--glass-bg-strong)] p-7 backdrop-blur-xl md:p-9">
            <span className="eyebrow eyebrow-cobalt">Create Account</span>
            <p className="mt-4 text-sm leading-relaxed text-white/70">
              填寫電郵與密碼即可建立帳號，無需審核。
            </p>

            <div className="mt-7">
              <SignupForm />
            </div>

            {/* 會員權益：節奏式排版，不用小卡片堆砌 */}
            <dl className="mt-8 border-t border-[var(--line-fine)] pt-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">
                Member Benefits
              </p>
              {BENEFITS.map((b) => (
                <div
                  key={b.k}
                  className="flex items-baseline justify-between gap-4 border-b border-[var(--line-fine)] py-2.5 last:border-b-0"
                >
                  <dt className="text-sm text-white/75">{b.k}</dt>
                  <dd className="stat-figure shrink-0 text-right text-sm text-vital-bright">
                    {b.v}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
