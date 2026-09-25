import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * 登出（前端以 fetch 呼叫）。
 * 這裡自行把 cookie 寫入回應物件，確保瀏覽器真的收到清除 Set-Cookie，
 * 不依賴 next/headers 的隱含行為。
 */
export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });

  if (!isSupabaseConfigured) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.signOut();

  return response;
}
