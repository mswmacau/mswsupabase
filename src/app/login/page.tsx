import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LoginForm } from "./LoginForm";
import { getCurrentProfile } from "@/lib/supabase/server";
import { RULES } from "@/lib/config";

export const metadata = { title: "會員登入" };

/** 左側宣言區的三聯事實：大數字主導，不用小圖標堆砌 */
const FACTS = [
  { value: `+${RULES.CHECKIN_POINTS}`, unit: "pts", label: "訓練簽到一次" },
  { value: `+${RULES.POINTS_PER_KM}`, unit: "pt / km", label: "每公里入帳" },
  { value: String(RULES.MONTHLY_GOAL_KM), unit: "km", label: "月度目標" },
] as const;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = next && next.startsWith("/") ? next : "/dashboard";

  const profile = await getCurrentProfile();
  if (profile) redirect(profile.role === "admin" ? "/admin" : target);

  // min-h-screen-safe：微信／iOS Safari 改用 svh，避免網址列遮住底部（定義見 globals.css）
  return (
    <section className="relative min-h-screen-safe overflow-hidden pb-20 pt-24 md:pt-28">
      {/* 單側光暈（只在右上，刻意不對稱） */}
      <div
        className="pointer-events-none absolute -right-[15%] -top-[28%] h-[560px] w-[560px] rounded-full blur-[130px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--color-cobalt) 78%, transparent), transparent 66%)",
          opacity: 0.42,
        }}
      />
      {/* 左下用幾何色塊代替第二顆光暈，避免左右對稱 */}
      <div className="clip-notch pointer-events-none absolute -bottom-16 -left-24 h-64 w-64 bg-vital/10" />

      {/* 手工質感：細網格 + 噪點 */}
      <div className="grid-lines absolute inset-0" />
      <div className="noise-overlay" />

      <div className="container-msw relative z-10">
        {/* 不對稱分欄：左敘事 / 右表單 */}
        <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          {/* ===== 左：宣言式大字 ===== */}
          <div className="flex gap-6 lg:pt-4">
            <span className="vlabel hidden shrink-0 text-white/40 lg:block">
              Members Only
            </span>

            <div className="min-w-0 flex-1">
              <Link
                href="/"
                className="inline-flex min-h-11 items-center gap-1.5 text-sm text-white/70 transition hover:text-white"
              >
                <ArrowLeft size={15} /> 回首頁
              </Link>

              <span className="eyebrow mt-8 block">Member Login</span>

              <h1 className="display-xl mt-6">
                <span className="block text-white">回到</span>
                <span className="mt-1 block">
                  <span className="text-outline">訓練</span>
                  <span className="text-vital-bright">現場</span>
                </span>
              </h1>

              <p className="mt-8 max-w-md text-base leading-relaxed text-white/70">
                登入後可報名定期訓練、上傳跑步紀錄與查看積分排行。
                里程與簽到都由後台確認後才入帳，讓每一次累積都算得清楚。
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

          {/* ===== 右：表單（去膠囊，斜切角 + 玻璃底） ===== */}
          <div className="clip-notch-br border border-[var(--line-fine)] bg-[var(--glass-bg-strong)] p-7 backdrop-blur-xl md:p-9">
            <span className="eyebrow eyebrow-cobalt">Account Access</span>
            <p className="mt-4 text-sm leading-relaxed text-white/70">
              使用電郵與密碼登入會員帳戶。
            </p>

            {target.startsWith("/admin") && (
              <p className="slab mt-5 border border-cobalt/40 bg-cobalt/10 px-3 py-2.5 text-xs leading-relaxed text-blue-200">
                管理員入口：請用管理員帳號登入，成功後會直接進入後台管理。
              </p>
            )}

            <div className="mt-7">
              <LoginForm next={target} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
