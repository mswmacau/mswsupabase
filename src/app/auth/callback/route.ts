import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * 電郵驗證連結 / OAuth 回調：把 code 換成 session。
 * 一律回**相對路徑**的 Location，避免在反向代理後被導向內網 localhost。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/dashboard";
  const next = rawNext.startsWith("/") ? rawNext : "/dashboard";

  if (code) {
    const supabase = await createClient();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return new NextResponse(null, {
          status: 303,
          headers: { Location: next },
        });
      }
    }
  }

  return new NextResponse(null, {
    status: 303,
    headers: { Location: "/login?error=auth" },
  });
}
