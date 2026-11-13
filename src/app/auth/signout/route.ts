import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/env";
import { withAuthCookieOptions } from "@/lib/supabase/cookie-options";

/**
 * Nav 的無 JS 備援登出（<form method="post">）。
 * Location 刻意用**相對路徑**：部署在反向代理／CDN 後面時，
 * request.nextUrl 可能解析成內網 localhost，絕對路徑會把使用者帶到連不上的網址。
 */
export async function POST(request: NextRequest) {
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: "/" },
  });

  if (!isSupabaseConfigured) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          // 與寫入端一致的屬性，確保刪除時能命中同一組 cookie
          response.cookies.set(name, value, withAuthCookieOptions(options));
        });
      },
    },
  });

  await supabase.auth.signOut();

  return response;
}
