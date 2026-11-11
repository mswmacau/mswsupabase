import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";
import { CompleteProfileForm, type ProfileDefaults } from "./CompleteProfileForm";

export const metadata: Metadata = {
  title: "完成註冊",
  robots: { index: false, follow: false },
};

/** 補填頁關心的欄位；型別本地宣告，不依賴 src/lib/types.ts 的 Profile 是否已加欄位 */
type CompletionFields = {
  full_name?: string | null;
  gender?: string | null;
  id_last4?: string | null;
  phone?: string | null;
};

const filled = (v?: string | null) => typeof v === "string" && v.trim() !== "";

/** 與 /auth/callback 同一個判斷：四欄齊了才算完成 */
function isComplete(p: CompletionFields | null): boolean {
  if (!p) return false;
  return (
    filled(p.full_name) && filled(p.gender) && filled(p.id_last4) && filled(p.phone)
  );
}

export default async function CompleteProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = safeNext(next, "/dashboard");

  // /complete-profile 不在 src/proxy.ts 的 matcher 內，登入守衛由本頁自己來
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent("/complete-profile")}`);
  }

  const supabase = await createClient();
  let profile: CompletionFields | null = null;
  if (supabase) {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, gender, id_last4, phone")
      .eq("id", user.id)
      .maybeSingle();
    profile = (data as CompletionFields | null) ?? null;
  }

  // 已補齊就不用再看這頁
  if (isComplete(profile)) redirect(target);

  // Google 帳號通常帶得到 name／full_name，先預填減少輸入
  const meta = (user.user_metadata ?? {}) as {
    full_name?: string;
    name?: string;
    phone?: string;
  };

  const defaults: ProfileDefaults = {
    full_name:
      profile?.full_name?.trim() || meta.full_name?.trim() || meta.name?.trim() || "",
    gender: profile?.gender?.trim() ?? "",
    phone: profile?.phone?.trim() ?? "",
    id_last4: profile?.id_last4?.trim() ?? "",
  };

  return (
    <section className="relative min-h-screen-safe overflow-hidden pb-20 pt-24 md:pt-28">
      {/* 單側光暈（右上，與登入頁同向但更收斂） */}
      <div
        className="pointer-events-none absolute -right-[15%] -top-[28%] h-[560px] w-[560px] rounded-full blur-[130px]"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--color-cobalt) 78%, transparent), transparent 66%)",
          opacity: 0.34,
        }}
      />
      <div className="grid-lines absolute inset-0" />
      <div className="noise-overlay" />

      <div className="container-msw relative z-10">
        <div className="mx-auto w-full max-w-md">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-white/70 transition hover:text-white"
          >
            <ArrowLeft size={15} /> 回首頁
          </Link>

          <div className="clip-notch-br mt-6 border border-[var(--line-fine)] bg-[var(--glass-bg-strong)] p-7 backdrop-blur-xl md:p-9">
            <p className="eyebrow">One More Step</p>
            <h1 className="section-title mt-3 text-white">完成註冊</h1>
            <p className="mt-3 text-sm leading-relaxed text-white/70">
              還差幾項資料就可以開始報名活動。
            </p>

            <div className="mt-7">
              <CompleteProfileForm
                next={target}
                email={user.email ?? ""}
                defaults={defaults}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
