import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export async function POST(request: Request) {
  if (!isSupabaseConfigured)
    return NextResponse.json(
      { ok: false, error: "尚未連接 Supabase，無法註冊。" },
      { status: 400 }
    );

  const { email, password, display_name } = (await request.json()) as {
    email?: string;
    password?: string;
    display_name?: string;
  };

  if (!email || !password)
    return NextResponse.json(
      { ok: false, error: "請填寫電郵與密碼。" },
      { status: 400 }
    );
  if (password.length < 6)
    return NextResponse.json(
      { ok: false, error: "密碼至少需要 6 個字元。" },
      { status: 400 }
    );

  const supabase = await createClient();
  if (!supabase)
    return NextResponse.json(
      { ok: false, error: "Supabase 客戶端初始化失敗。" },
      { status: 500 }
    );

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: display_name?.trim() || email.split("@")[0] },
      emailRedirectTo: siteUrl ? `${siteUrl}/auth/callback` : undefined,
    },
  });

  if (error) {
    let msg = error.message;
    if (/already registered/i.test(msg)) msg = "此電郵已註冊，請直接登入。";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  // 站台若關閉電郵驗證，會直接拿到 session
  if (data.session) {
    return NextResponse.json({ ok: true, next: "/dashboard", needConfirm: false });
  }

  return NextResponse.json({
    ok: true,
    needConfirm: true,
    message:
      "註冊成功！請到電郵信箱點擊驗證連結完成啟用，之後即可登入。",
  });
}
