import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { jsonBadJson, jsonInternal, jsonValidation, readJson } from "@/lib/api";
import { parseRealNameFields } from "@/lib/profile-fields";

/**
 * 會員註冊（API Route 而非 Server Action）
 *
 * 【順手修】原本 `await request.json()` 無保護，畸形 body 會裸奔成 500 空 body
 * （違反 SPEC H6）。改用 readJson() + jsonBadJson() 並包 try/catch；
 * 其餘回應內容與 HTTP status 一字不改。
 *
 * 【付費活動／實名資料】新增選填欄位 full_name / gender / phone / id_last4：
 *   寫進 options.data（raw_user_meta_data），由 handle_new_user() 搬進 profiles
 *   （supabase/migration-paid-events-1.sql G 段）。選填的理由：註冊頁與
 *   /complete-profile 兩條路都要能走，前端只送 email/password 時不可 400。
 *   一旦有送，驗證口徑與 /api/profile/complete 完全相同（同一支 parser）。
 */
export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured)
      return NextResponse.json(
        { ok: false, error: "尚未連接 Supabase，無法註冊。" },
        { status: 400 }
      );

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";

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

    // 實名資料：可以完全不填，但填了就必須合法（不合法 → 400 + 欄位錯誤）
    const parsedRealName = parseRealNameFields(body, "optional");
    if (!parsedRealName.ok) return jsonValidation(parsedRealName.fields);
    const realName = parsedRealName.value;

    const supabase = await createClient();
    if (!supabase)
      return NextResponse.json(
        { ok: false, error: "Supabase 客戶端初始化失敗。" },
        { status: 500 }
      );

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

    // display_name 保底順序：前端指定 → 真實姓名 → 電郵前綴
    const profileDisplayName =
      displayName || realName.full_name || email.split("@")[0];

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: profileDisplayName,
          // 以下四項由 handle_new_user() 清洗後寫入 profiles（非法值會降級成 null，
          // 不會擋註冊）；null 也照送，讓 metadata 結構固定。
          full_name: realName.full_name,
          gender: realName.gender,
          phone: realName.phone,
          id_last4: realName.id_last4,
        },
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
  } catch (err) {
    return jsonInternal("POST /api/auth/signup", err);
  }
}
