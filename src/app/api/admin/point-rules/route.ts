import { revalidatePath } from "next/cache";
import { authorizeAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { createAdminClient, isServiceRoleConfigured } from "@/lib/supabase/admin";
import {
  isUuid,
  jsonBadJson,
  jsonDbError,
  jsonErr,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotFound,
  jsonOk,
  jsonValidation,
  readJson,
} from "@/lib/api";

/**
 * /api/admin/point-rules — 積分規則（app_settings）與手動補發（管理員限定）
 *
 * GET  （無參數）             → 11 個規則值 + rewards_enabled
 * GET  ?mode=members&q=       → 會員搜尋（補發用）
 * GET  ?mode=checkins&user_id=→ 該會員最近簽到（活動／打卡補發的 ref_id）
 * POST { action:"save", rules:{...}, rewards_enabled? }
 * POST { action:"award", type, user_id, ref_id? , ref_user_id? }
 *
 * ⚠️ 活動／打卡補發的 ref_id 必須是該會員的 training_checkins.id（不是 event id）。
 *    這支 route 會先驗「該簽到真的屬於該會員」，才呼叫 RPC。
 *
 * ⚠️ award_* 四支 RPC 在 migration 內被 revoke 了 authenticated 的 EXECUTE，
 *    只用 anon key 的管理員 session 會收到 42501。這裡優先用 service_role
 *    客戶端（函式內建 is_admin() or service_role 閘門），未配置時退回使用者
 *    session，並把 42501 翻成可讀訊息（附修復用的 migration 檔名）。
 */

type Body = Record<string, unknown>;

type RuleKey =
  | "signup_bonus"
  | "daily_login_points"
  | "event_bonus"
  | "referral_bonus"
  | "referral_monthly_cap"
  | "birthday_bonus"
  | "streak_bonus"
  | "streak_days"
  | "checkin_bonus"
  | "checkin_weekly_cap"
  | "monthly_points_bonus";

const RULE_LIMITS: Record<RuleKey, { min: number; max: number }> = {
  signup_bonus: { min: 0, max: 100000 },
  daily_login_points: { min: 0, max: 10000 },
  event_bonus: { min: 0, max: 100000 },
  referral_bonus: { min: 0, max: 100000 },
  referral_monthly_cap: { min: 0, max: 1000 },
  birthday_bonus: { min: 0, max: 100000 },
  streak_bonus: { min: 0, max: 100000 },
  streak_days: { min: 1, max: 365 },
  checkin_bonus: { min: 0, max: 100000 },
  checkin_weekly_cap: { min: 0, max: 1000 },
  monthly_points_bonus: { min: 0, max: 1000000 },
};

const RULE_KEYS = Object.keys(RULE_LIMITS) as RuleKey[];

const AWARD_TYPES = ["birthday", "referral", "event", "checkin"] as const;
type AwardType = (typeof AWARD_TYPES)[number];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
}

type AwardResult = {
  ok?: boolean;
  code?: string;
  points?: number;
  skipped?: boolean;
  reason?: string;
  used?: number;
  cap?: number;
  year?: number;
};

export async function GET(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase } = auth;

    const url = new URL(request.url);
    const mode = text(url.searchParams.get("mode"));

    /* ---------- 會員搜尋（手動補發用） ---------- */
    if (mode === "members") {
      const q = text(url.searchParams.get("q"));
      let query = supabase
        .from("profiles")
        .select("id,display_name,points,created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (q) query = query.ilike("display_name", `%${q}%`);

      const { data, error } = await query;
      if (error) return jsonDbError("GET /api/admin/point-rules members", error);
      return jsonOk({ members: data ?? [] });
    }

    /* ---------- 某會員最近簽到（ref_id 來源） ---------- */
    if (mode === "checkins") {
      const userId = text(url.searchParams.get("user_id"));
      if (!isUuid(userId)) return jsonValidation({ user_id: "會員編號格式錯誤。" });

      const { data, error } = await supabase
        .from("training_checkins")
        .select("id,created_at,status,session:training_sessions(title,session_date,starts_at)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) return jsonDbError("GET /api/admin/point-rules checkins", error);
      return jsonOk({ checkins: data ?? [] });
    }

    /* ---------- 規則現值 ---------- */
    const { data, error } = await supabase
      .from("app_settings")
      .select("key,value")
      .in("key", [...RULE_KEYS, "rewards_enabled"]);

    if (error) return jsonDbError("GET /api/admin/point-rules", error);

    const rules: Record<string, number> = {};
    for (const key of RULE_KEYS) rules[key] = 0;
    let rewardsEnabled = false;

    for (const row of data ?? []) {
      const r = row as { key: string; value: unknown };
      if (r.key === "rewards_enabled") {
        const v = typeof r.value === "string" ? r.value === "true" : Boolean(r.value);
        rewardsEnabled = v;
        continue;
      }
      const parsed = num(r.value);
      if (Number.isFinite(parsed)) rules[r.key] = parsed;
    }

    return jsonOk({
      rules,
      rewards_enabled: rewardsEnabled,
      has_service_role: isServiceRoleConfigured,
    });
  } catch (err) {
    return jsonInternal("GET /api/admin/point-rules", err);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authorizeAdmin();
    if (!auth.ok) return auth.res;
    const { supabase, actorId } = auth;

    const body = (await readJson(request)) as Body | null;
    if (!body) return jsonBadJson();

    const action = text(body.action);

    /* =========================================================
     * 儲存 11 個規則值（含 rewards_enabled 開關）
     * ========================================================= */
    if (action === "save") {
      const input = body.rules;
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return jsonValidation({}, "缺少規則內容。");
      }

      const fields: Record<string, string> = {};
      const rows: { key: string; value: number | boolean; updated_at: string }[] = [];
      const now = new Date().toISOString();

      for (const key of RULE_KEYS) {
        const raw = (input as Record<string, unknown>)[key];
        const value = num(raw);
        const limit = RULE_LIMITS[key];
        if (!Number.isFinite(value) || !Number.isInteger(value) || value < limit.min || value > limit.max) {
          fields[key] = `需為 ${limit.min}–${limit.max} 的整數。`;
          continue;
        }
        rows.push({ key, value, updated_at: now });
      }

      const enabledInput = body.rewards_enabled;
      if (enabledInput !== undefined) {
        if (typeof enabledInput !== "boolean") {
          fields.rewards_enabled = "開關只接受開或關。";
        } else {
          rows.push({ key: "rewards_enabled", value: enabledInput, updated_at: now });
        }
      }

      if (Object.keys(fields).length > 0) return jsonValidation(fields);

      const { error } = await supabase
        .from("app_settings")
        .upsert(rows, { onConflict: "key" });

      if (error) return jsonDbError("POST /api/admin/point-rules save", error);

      const summary =
        rows.find((r) => r.key === "rewards_enabled") !== undefined
          ? `更新積分規則（${rows.length - 1} 項）並${rows.find((r) => r.key === "rewards_enabled")?.value ? "開啟" : "關閉"}兌換功能`
          : `更新積分規則（${rows.length} 項）`;

      await writeAuditLog(supabase, actorId, "point-rules", "save", summary);
      revalidatePath("/admin/point-rules");
      revalidatePath("/admin");
      revalidatePath("/dashboard");

      return jsonOk({ message: "積分規則已儲存。" });
    }

    /* =========================================================
     * 手動補發
     * ========================================================= */
    if (action === "award") {
      const type = text(body.type) as AwardType;
      if (!(AWARD_TYPES as readonly string[]).includes(type)) {
        return jsonValidation({ type: "不支援的補發類型。" });
      }

      const userId = text(body.user_id);
      if (!isUuid(userId)) return jsonValidation({ user_id: "請選擇會員。" });

      const refId = text(body.ref_id);
      const refUserId = text(body.ref_user_id);

      if (type === "referral") {
        if (!isUuid(refUserId)) return jsonValidation({ ref_user_id: "請選擇被邀請的會員。" });
        if (refUserId === userId) {
          return jsonValidation({ ref_user_id: "邀請人與被邀請人不可相同。" });
        }
      }

      if (type === "event" || type === "checkin") {
        if (!isUuid(refId)) return jsonValidation({ ref_id: "請選擇該會員的簽到紀錄。" });
        // 驗簽到屬於該會員，避免把別人的簽到 id 當 ref_id（會變成幫錯人防重）
        const { data: checkin, error: cErr } = await supabase
          .from("training_checkins")
          .select("id,user_id")
          .eq("id", refId)
          .maybeSingle();
        if (cErr) return jsonDbError("POST /api/admin/point-rules checkin", cErr);
        if (!checkin) return jsonNotFound("找不到這筆簽到紀錄。");
        if ((checkin as { user_id?: string }).user_id !== userId) {
          return jsonValidation({ ref_id: "這筆簽到不屬於所選會員，請重新選擇。" });
        }
      }

      /* 優先用 service_role：award_* 已對 authenticated revoke EXECUTE */
      let rpcClient = supabase;
      if (isServiceRoleConfigured) {
        try {
          rpcClient = createAdminClient();
        } catch {
          rpcClient = supabase;
        }
      }

      type RpcCall = ReturnType<typeof rpcClient.rpc>;
      let call: RpcCall;
      if (type === "birthday") {
        call = rpcClient.rpc("award_birthday", { p_user_id: userId });
      } else if (type === "referral") {
        call = rpcClient.rpc("award_referral", {
          p_referrer: userId,
          p_new_user: refUserId,
        });
      } else if (type === "event") {
        call = rpcClient.rpc("award_event_participation", {
          p_user_id: userId,
          p_ref: refId,
        });
      } else {
        call = rpcClient.rpc("award_checkin_bonus", { p_user_id: userId, p_ref: refId });
      }

      const { data, error } = await call;

      if (error) {
        if (error.code === "PGRST202") {
          return jsonErr("補發功能暫未部署。", "SCHEMA_OUTDATED", 503);
        }
        if (error.code === "42501" || /permission denied/i.test(error.message ?? "")) {
          return jsonErr(
            "資料庫未開放補發權限：請先執行 supabase/migration-points-r1-4-admin-grants.sql，或設定 SUPABASE_SERVICE_ROLE_KEY。",
            "SCHEMA_OUTDATED",
            503
          );
        }
        return jsonDbError("POST /api/admin/point-rules award", error);
      }

      const result = (Array.isArray(data) ? data[0] : data) as AwardResult | null;

      if (!result?.ok) {
        if (result?.code === "NOT_ADMIN") return jsonErr("權限不足。", "FORBIDDEN", 403);
        if (result?.code === "INVALID_ARGUMENT") {
          return jsonValidation({}, "補發參數不正確，請重新選擇。");
        }
        return jsonErr("補發失敗，請稍後再試。", "INTERNAL", 500);
      }

      /* RPC 特有的「已發過／達上限」是 ok:true + skipped，要如實告訴管理員 */
      if (result.skipped) {
        const reasonMap: Record<string, string> = {
          ALREADY_AWARDED: "此筆已曾發放，系統沒有重複加分。",
          ALREADY_AWARDED_YEAR: `該會員 ${result.year ?? ""} 年已領過生日禮，沒有重複加分。`,
          MONTHLY_CAP: `本月邀請獎已達上限（${result.used ?? "?"}/${result.cap ?? "?"} 人），沒有加分。`,
        };
        const message = reasonMap[result.reason ?? ""] ?? "系統判斷無需重複發放。";
        await writeAuditLog(
          supabase,
          actorId,
          "point-rules",
          "award",
          `手動補發 ${type}：未發放（${result.reason ?? "SKIPPED"}）`
        );
        revalidatePath("/admin/point-rules");
        return jsonOk({ skipped: true, message });
      }

      const points = Number(result.points ?? 0);
      await writeAuditLog(
        supabase,
        actorId,
        "point-rules",
        "award",
        `手動補發 ${type}：+${points} 分`
      );
      revalidatePath("/admin/point-rules");
      revalidatePath("/admin");
      revalidatePath("/dashboard");

      return jsonOk({ points, message: `已補發 ${points} 分。` });
    }

    return jsonValidation({}, "不支援的操作。");
  } catch (err) {
    return jsonInternal("POST /api/admin/point-rules", err);
  }
}

export async function DELETE() {
  return jsonMethodNotAllowed();
}
