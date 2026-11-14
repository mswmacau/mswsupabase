import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { AdminNav } from "@/components/AdminNav";
import { getAdminTodoCounts } from "@/lib/queries";
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

  /*
   * 側欄「待審核」的待辦數字（IA 第二階段 C）。
   *
   * 為什麼在 layout 取：側欄每一頁都在，數字必須跨頁一致；若各自在頁面取，
   * 換頁時會出現「側欄 3、頁面 0」的錯位。
   * 為什麼任一項是 null 就整體顯示「—」：四類相加只有在四類都確定時才有意義，
   * 用已知的三項相加會少報（管理員會漏按）。null 的顯示規則見 AdminNav。
   */
  const todos = await getAdminTodoCounts();
  const todoValues = [
    todos.pendingRuns,
    todos.pendingCheckins,
    todos.pendingRedemptions,
    todos.pendingHyroxPayments,
  ];
  const pendingTotal = todoValues.every((v) => v !== null)
    ? (todoValues as number[]).reduce((sum, v) => sum + v, 0)
    : null;

  return (
    <section className="pt-20 pb-20 md:pt-[5.5rem]">
      <div className="container-msw">
        {/*
         * h1 只留給螢幕閱讀器：桌面先前那行「MSW 後台管理」佔掉 60px，
         * 是 20 項側欄在 900px 高視窗被截斷的最後一根稻草。
         * 視覺上的「你在後台」由 <768px 的 56px 列與 ≥768px 的分組側欄承擔。
         */}
        <h1 className="sr-only">MSW 後台管理</h1>

        <div className="grid gap-6 md:grid-cols-[220px_1fr] md:gap-8">
          <aside className="min-w-0 md:sticky md:top-[5.5rem] md:self-start">
            {/* overflow-y-auto 只在視窗高度 < 760px 時當保險；1440×900 不得觸發 */}
            <div className="card-dark overflow-hidden p-0 md:max-h-[calc(100dvh-5rem)] md:overflow-y-auto md:overscroll-contain md:p-2">
              <AdminNav pendingTotal={pendingTotal} />
            </div>
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </section>
  );
}
