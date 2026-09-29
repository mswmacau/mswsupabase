/**
 * ⚠️ 本檔檔名必須維持 `proxy.ts`，請勿改名。
 *
 * 1. Next.js 16 起已將 `middleware` 檔案慣例「棄用並更名為 Proxy」
 *    （v16.0.0 release notes：Middleware is deprecated and renamed to Proxy），
 *    且 Proxy 預設跑在 Node.js runtime。本站 next 版本為 16.3.6，
 *    因此本檔是「生效中的正規中介層」，不是死碼。
 *
 * 2. 不要改名為 `middleware.ts`：那是 Next ≤15 的舊慣例，已被官方棄用，
 *    且兩者預設 runtime 不同（Edge vs Node.js），改名會踩到 runtime 差異，
 *    導致 Supabase SSR 的 cookie 行為出現非預期結果。
 *
 * 3. `export const config.matcher` 請勿加入 `/api/*` 路徑：
 *    一旦把 API 路徑納入 matcher，未登入呼叫 `/api/admin/*` 會從原本的
 *    JSON 401 變成 307 重導到 `/login`（HTML），前端 `res.json()` 會直接拋錯，
 *    屬回歸 bug。API 的鑑權一律由各 route handler 自行處理。
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/env";

export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // 刷新 session，務必呼叫以維持登入狀態
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (!user && pathname.startsWith("/admin")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
