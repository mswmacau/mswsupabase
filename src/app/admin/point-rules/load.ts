import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { MemberOption, RuleValues } from "./PointRulesForm";

/**
 * 積分規則／會員下拉的伺服器端取數（從 point-rules/page.tsx 抽出來）。
 *
 * 為什麼要抽：IA 第二階段把這一頁拆成 `/admin/points` 的兩個分頁
 * （規則 tab 與補發獎勵 tab 都要同一份資料），舊路由 `/admin/point-rules`
 * 也還要能用。三處各寫一份查詢，規則 key 清單一定會分岔——
 * 漏一個 key 不會報錯，只會讓某類加分悄悄變 0。
 *
 * 查詢內容與 HEAD 的 point-rules/page.tsx 完全一致：
 * 同一份 11 個規則 key（+ rewards_enabled）、同樣 limit 20 的會員下拉、
 * 同樣把 value 轉成 number 的防呆。
 */

export const RULE_KEYS = [
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

export interface PointRulesData {
  rules: RuleValues;
  enabled: boolean;
  members: MemberOption[];
  loadError: boolean;
  notConfigured: boolean;
}

export async function loadPointRules(): Promise<PointRulesData> {
  const rules: RuleValues = Object.fromEntries(
    RULE_KEYS.map((k) => [k, 0])
  ) as RuleValues;

  if (!isSupabaseConfigured) {
    return { rules, enabled: false, members: [], loadError: true, notConfigured: true };
  }

  const supabase = await createClient();
  if (!supabase) {
    return { rules, enabled: false, members: [], loadError: true, notConfigured: false };
  }

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
    return { rules, enabled: false, members: [], loadError: true, notConfigured: false };
  }

  let enabled = false;
  for (const row of settings.data ?? []) {
    const r = row as { key: string; value: unknown };
    if (r.key === "rewards_enabled") {
      enabled = typeof r.value === "string" ? r.value === "true" : Boolean(r.value);
      continue;
    }
    const n = typeof r.value === "number" ? r.value : Number(r.value);
    if (Number.isFinite(n)) rules[r.key] = n;
  }

  const members = (
    (memberRows.data ?? []) as { id: string; display_name: string | null; points: number }[]
  ).map((m) => ({
    id: m.id,
    display_name: m.display_name,
    points: Number(m.points ?? 0),
  }));

  return { rules, enabled, members, loadError: false, notConfigured: false };
}
