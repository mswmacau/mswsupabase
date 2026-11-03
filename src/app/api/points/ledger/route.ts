import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getPointLedger } from "@/lib/rewards";
import {
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotConfigured,
  jsonOk,
  jsonUnauthenticated,
} from "@/lib/api";

/**
 * GET /api/points/ledger?limit=20&offset=0 — 積分明細分頁
 *
 * 會員只讀自己的列（RLS），不接受任何 user_id 參數。
 */
export async function POST() {
  return jsonMethodNotAllowed();
}

export async function GET(request: Request) {
  try {
    if (!isSupabaseConfigured) return jsonNotConfigured();

    const supabase = await createClient();
    if (!supabase) return jsonNotConfigured();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonUnauthenticated();

    const { searchParams } = new URL(request.url);
    const rawLimit = Number(searchParams.get("limit") ?? "20");
    const rawOffset = Number(searchParams.get("offset") ?? "0");

    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50) : 20;
    const offset = Number.isFinite(rawOffset) ? Math.max(Math.trunc(rawOffset), 0) : 0;

    const { rows, hasMore } = await getPointLedger(user.id, limit, offset);
    return jsonOk({ rows, hasMore });
  } catch (err) {
    return jsonInternal("GET /api/points/ledger", err);
  }
}
