import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

/** 補填頁需要齊的欄位；任一為空就先去 /complete-profile */
type CompletionFields = {
  full_name?: string | null;
  gender?: string | null;
  id_last4?: string | null;
  phone?: string | null;
};

function needsCompletion(p: CompletionFields | null): boolean {
  if (!p) return true; // 還沒有 profiles 列（首次 OAuth 登入）＝視為未補齊
  const filled = (v?: string | null) => typeof v === "string" && v.trim() !== "";
  return (
    !filled(p.full_name) ||
    !filled(p.gender) ||
    !filled(p.id_last4) ||
    !filled(p.phone)
  );
}

/**
 * 電郵驗證連結 / OAuth 回調：把 code 換成 session。
 * 一律回**相對路徑**的 Location，避免在反向代理後被導向內網 localhost。
 *
 * 換到 session 之後多做一件事（Google 註冊的人資料不齊）：
 * 若 full_name / gender / id_last4 / phone 任一為空 → 轉去 /complete-profile 補填，
 * 補完再回到原本的 next。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/dashboard";
  // 防開放重定向：本值會直接寫進 Location 標頭，必須過白名單（擋 //evil.com、/\evil.com、/api/*）
  const next = safeNext(rawNext, "/dashboard");

  if (!code) return fail();

  const supabase = await createClient();
  if (!supabase) return fail();

  // Route Handler 內可以寫 cookie（server.ts 的 setAll 會走 cookieStore.set），
  // 換 session 後的 token 才會落進瀏覽器。
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, gender, id_last4, phone")
    .eq("id", user.id)
    .maybeSingle();

  // 查詢失敗（DB 暫時不可用、欄位尚未建立）一律「放行」到 next，
  // 不可因為一次查詢錯誤把人卡在補填頁轉圈（同 src/proxy.ts 的既有取捨）。
  if (profileError) return redirectTo(next);

  if (needsCompletion(profile as CompletionFields | null)) {
    return redirectTo(
      `/complete-profile?next=${encodeURIComponent(next)}`
    );
  }

  return redirectTo(next);
}

/** 相對路徑 Location；303 與本檔既有寫法一致（GET → GET，語意等同 302 且不會被改寫成 POST） */
function redirectTo(location: string) {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location },
  });
}

/** 沒有 code 或換 session 失敗：回首頁並由登入頁顯示可讀訊息 */
function fail() {
  return redirectTo("/login?error=oauth");
}
