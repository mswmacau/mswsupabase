import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { AdminNav } from "@/components/AdminNav";
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
          <p className="mt-3 text-sm leading-relaxed text-white/75">
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
    // proxy 已處理未登入，這裡是第二道防線：確保永遠不會以 200 渲染後台外殼
    redirect("/login?next=/admin");
  }

  if (profile.role !== "admin") {
    // 非管理員一律導走（原本回 200 +「權限不足」頁，HTTP 語意錯誤）
    redirect("/dashboard");
  }

  return (
    <section className="pt-20 pb-20 md:pt-28">
      <div className="container-msw">
        {/* <768px 時由 AdminNav 的 56px 抽屜列帶「後台」標題，這裡不重複佔高度 */}
        <div className="mb-8 hidden md:block">
          <h1 className="mt-2 text-2xl font-black">MSW 後台管理</h1>
        </div>

        <div className="grid gap-6 md:grid-cols-[220px_1fr] md:gap-8">
          <aside className="min-w-0 md:sticky md:top-24 md:self-start">
            <div className="card-dark overflow-hidden p-0 md:p-3 md:max-h-[calc(100vh-7.5rem)] md:overflow-y-auto md:overscroll-contain">
              <AdminNav />
            </div>
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </section>
  );
}
