import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { AdminNav } from "@/components/AdminNav";
import { LogoutButton } from "@/components/LogoutButton";
import { getCurrentProfile } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();

  if (!isSupabaseConfigured) {
    return (
      <section className="pt-32 pb-20">
        <div className="container-msw max-w-lg text-center">
          <ShieldAlert size={40} className="mx-auto text-amber-400" />
          <h1 className="mt-5 text-2xl font-bold">後台尚未啟用</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/55">
            請先在 <code className="font-mono">.env.local</code> 填入 Supabase 的
            URL 與 anon key，並執行{" "}
            <code className="font-mono">supabase/schema.sql</code>
            ，再把你的帳號設為管理員：
          </p>
          <pre className="mt-4 overflow-x-auto rounded-xl border border-ink-line bg-black/40 p-4 text-left text-xs text-white/70">
            {`update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');`}
          </pre>
        </div>
      </section>
    );
  }

  if (!profile) {
    return (
      <section className="pt-32 pb-20 text-center">
        <div className="container-msw">
          <h1 className="text-2xl font-bold">請先登入</h1>
          <Link href="/login?next=/admin" className="btn-base btn-vital mt-6">
            會員登入
          </Link>
        </div>
      </section>
    );
  }

  if (profile.role !== "admin") {
    return (
      <section className="pt-32 pb-20 text-center">
        <div className="container-msw max-w-md">
          <ShieldAlert size={40} className="mx-auto text-vital" />
          <h1 className="mt-5 text-2xl font-bold">權限不足</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/55">
            目前登入的是「{profile.display_name ?? "會員"}」，此帳號不是管理員。
            請登出後改用管理員帳號登入，或在 Supabase 把這個帳號的 role 設為 admin。
          </p>
          <div className="mx-auto mt-7 max-w-[220px]">
            <LogoutButton className="btn-base btn-ghost justify-center" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="pt-24 pb-20 md:pt-28">
      <div className="container-msw">
        <div className="mb-8">
          <span className="eyebrow">Admin Console</span>
          <h1 className="mt-2 text-2xl font-black">MSW 後台管理</h1>
        </div>

        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
            <div className="card-dark overflow-hidden p-3">
              <AdminNav />
            </div>
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </section>
  );
}
