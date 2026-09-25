import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LoginForm } from "./LoginForm";
import { getCurrentProfile } from "@/lib/supabase/server";

export const metadata = { title: "會員登入" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = next && next.startsWith("/") ? next : "/dashboard";

  const profile = await getCurrentProfile();
  if (profile) redirect(profile.role === "admin" ? "/admin" : target);

  return (
    <section className="relative min-h-[calc(100vh-4rem)] overflow-hidden pt-28 pb-20">
      <div className="hero-grid absolute inset-0 opacity-40" />
      <div
        className="pointer-events-none absolute left-1/2 top-10 h-[420px] w-[420px] -translate-x-1/2 rounded-full blur-[120px]"
        style={{
          background: "radial-gradient(circle, rgba(0,71,171,0.5), transparent 65%)",
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
              <span className="eyebrow">Member Login</span>
              <h1 className="mt-3 text-3xl font-black">會員登入</h1>
              <p className="mt-2 text-sm text-white/50">
                登入後可報名訓練、上傳跑步紀錄與查看積分
              </p>
              {target.startsWith("/admin") && (
                <p className="mt-3 rounded-lg border border-cobalt/40 bg-cobalt/10 px-3 py-2 text-xs text-blue-200">
                  管理員入口：請用管理員帳號登入，成功後會直接進入後台管理。
                </p>
              )}
            </div>

            <LoginForm next={target} />
          </div>
        </div>
      </div>
    </section>
  );
}
