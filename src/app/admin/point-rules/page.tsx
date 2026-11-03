import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isServiceRoleConfigured } from "@/lib/supabase/admin";
import { PointRulesForm, type RuleValues } from "./PointRulesForm";

export const metadata = { title: "積分規則" };
export const dynamic = "force-dynamic";

const RULE_KEYS = [
  "signup_bonus",
  "daily_login_points",
  "event_bonus",
  "referral_bonus",
  "referral_monthly_cap",
  "birthday_bonus",
  "streak_bonus",
  "streak_days",
  "checkin_bonus",
  "checkin_weekly_cap",
  "monthly_points_bonus",
] as const;

/**
 * /admin/point-rules — 積分規則與手動補發
 *
 * 規則值存 app_settings（key → jsonb number），會員已可讀，寫入受 RLS 限制為管理員。
 * 手動補發一律經 /api/admin/point-rules，由後端呼叫 award_* RPC（含防重複）。
 */
export default async function AdminPointRulesPage() {
  if (!isSupabaseConfigured) {
    return (
      <Shell>
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          尚未連接 Supabase，暫時無法讀取積分規則。
        </div>
      </Shell>
    );
  }

  const supabase = await createClient();
  const rules: RuleValues = Object.fromEntries(RULE_KEYS.map((k) => [k, 0])) as RuleValues;
  let enabled = false;
  let members: { id: string; display_name: string | null; points: number }[] = [];
  let loadError = false;

  if (supabase) {
    const [settings, memberRows] = await Promise.all([
      supabase
        .from("app_settings")
        .select("key,value")
        .in("key", [...RULE_KEYS, "rewards_enabled"]),
      supabase
        .from("profiles")
        .select("id,display_name,points")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (settings.error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[admin/point-rules] query failed:", settings.error.message);
      }
      loadError = true;
    } else {
      for (const row of settings.data ?? []) {
        const r = row as { key: string; value: unknown };
        if (r.key === "rewards_enabled") {
          enabled = typeof r.value === "string" ? r.value === "true" : Boolean(r.value);
          continue;
        }
        const n = typeof r.value === "number" ? r.value : Number(r.value);
        if (Number.isFinite(n)) rules[r.key] = n;
      }
      members = ((memberRows.data ?? []) as { id: string; display_name: string | null; points: number }[]).map(
        (m) => ({ id: m.id, display_name: m.display_name, points: Number(m.points ?? 0) })
      );
    }
  } else {
    loadError = true;
  }

  return (
    <Shell>
      {loadError ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          積分規則暫時讀不到，請稍後重新整理；若持續失敗請聯絡技術人員。
        </div>
      ) : (
        <PointRulesForm
          initialRules={rules}
          initialEnabled={enabled}
          initialMembers={members}
          hasServiceRole={isServiceRoleConfigured}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h2 className="text-xl font-bold">積分規則</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          調整各項自動加分的數值，或手動為個別會員補發。數值只影響之後的發放，
          不會追溯改動已入帳的積分。
        </p>
      </div>
      {children}
    </div>
  );
}
