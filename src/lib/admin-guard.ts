/**
 * src/lib/admin-guard.ts — 後台新 API 共用的「先驗管理員」步驟
 *
 * 與 src/app/api/admin/review-run/route.ts 完全同一套順序：
 *   未連接 Supabase → 400、未登入 → 401、非管理員 → 403。
 * 差別只在於把重複的五段樣板收斂成一個函式，回傳 supabase client 與 actorId
 * （actorId 給 admin_audit_log 用）。
 *
 * 刻意不回傳任何錯誤細節給瀏覽器；細節只寫 server log（見 src/lib/api.ts）。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  jsonForbidden,
  jsonNotConfigured,
  jsonUnauthenticated,
} from "@/lib/api";

export type AdminAuthResult =
  | { ok: true; supabase: SupabaseClient; actorId: string }
  | { ok: false; res: Response };

export async function authorizeAdmin(): Promise<AdminAuthResult> {
  if (!isSupabaseConfigured) return { ok: false, res: jsonNotConfigured() };

  const supabase = await createClient();
  if (!supabase) return { ok: false, res: jsonNotConfigured() };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, res: jsonUnauthenticated() };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") return { ok: false, res: jsonForbidden() };

  return { ok: true, supabase, actorId: user.id };
}
