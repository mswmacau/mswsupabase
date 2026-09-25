import { isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * 尚未連接 Supabase 時顯示的提示條。
 * 讓你在註冊 Supabase 之前也能先把網站跑起來看版型。
 */
export function SetupBanner() {
  if (isSupabaseConfigured) return null;
  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-center text-sm text-amber-200">
      尚未連接 Supabase — 請在 <code className="font-mono">.env.local</code>{" "}
      填入 <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> 與{" "}
      <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
      ，並執行 <code className="font-mono">supabase/schema.sql</code>。
      目前顯示的是空資料版型。
    </div>
  );
}
