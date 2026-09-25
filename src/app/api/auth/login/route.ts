import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * 會員登入（API Route 而非 Server Action）
 * 註：部署平台的 WAF 會攔截帶 next-action 標頭的請求，故全站寫入操作改用 API Route。
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured)
    return NextResponse.json(
      { ok: false, error: "尚未連接 Supabase，無法登入。" },
      { status: 400 }
    );

  const { email, password, next } = (await request.json()) as {
    email?: string;
    password?: string;
    next?: string;
  };

  if (!email || !password)
    return NextResponse.json(
      { ok: false, error: "請填寫電郵與密碼。" },
      { status: 400 }
    );

  const supabase = await createClient();
  if (!supabase)
    return NextResponse.json(
      { ok: false, error: "Supabase 客戶端初始化失敗。" },
      { status: 500 }
    );

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    let msg = error.message;
    if (/email not confirmed/i.test(msg)) msg = "請先到電郵信箱點擊驗證連結，再回來登入。";
    else if (/invalid login/i.test(msg)) msg = "電郵或密碼錯誤。";
    return NextResponse.json({ ok: false, error: msg }, { status: 401 });
  }

  // 判斷是否管理員，導向對應頁面
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  let target = next && next.startsWith("/") && !next.startsWith("/admin")
    ? next
    : "/dashboard";
  if (!next && profile?.role === "admin") target = "/admin";

  return NextResponse.json({ ok: true, next: target });
}
