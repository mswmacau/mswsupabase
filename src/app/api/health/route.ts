/**
 * GET /api/health — Health check / keep-alive（公開）
 *
 * 硬性要求：不可查 DB。Supabase 免費專案暫停時，health check 本身不能變慢，
 * 否則 UptimeRobot 會誤判網站掛掉（見 SPEC §4.5）。
 *
 * Owner：白客
 */

import { jsonOk } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET() {
  return jsonOk({ ts: Date.now() });
}
