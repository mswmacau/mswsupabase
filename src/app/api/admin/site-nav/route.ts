/**
 * /api/admin/site-nav — 全站選單（管理員限定）
 *
 * GET    讀取 site_nav（DB 無值 → 回落預設）→ { ok: true, data }
 * POST   儲存整包 SiteNav → 200；結構不合法 → 400（fields），DB 不寫
 * DELETE 回復原廠選單（只重置 site_nav 一列，不動其他資料）→ 200
 *
 * 契約：計劃 V2 §8.1（site-nav 為 V1 既有路由，本檔為 T-3 補齊五鍵之一）
 * T-15：POST/DELETE 成功後各寫一筆 admin_audit_log（module=site-nav，
 *       action=save/restore；best-effort，見 src/lib/audit.ts）
 * Owner：白客
 *
 * H6：全部包 try/catch，任何情況都回 JSON。
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { DEFAULT_NAV, coerceNav, normalizeNav, type SiteNav } from "@/lib/content";
import {
  jsonBadJson,
  jsonForbidden,
  jsonInternal,
  jsonNotConfigured,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

import { SITE_NAV_TAG } from "@/lib/queries";

const SITE_NAV_KEY = "site_nav";

/** H4：Supabase 設定檢查 → 未登入 401 → 非管理員 403（复刻 site-settings） */
async function authorizeAdmin() {
  if (!isSupabaseConfigured) return { res: jsonNotConfigured() } as const;

  const supabase = await createClient();
  if (!supabase) return { res: jsonNotConfigured() } as const;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { res: jsonUnauthenticated() } as const;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { res: jsonForbidden() } as const;

  // T-15：actorId 一併回傳（操作日誌的 actor_id = 授權管理員 user.id）
  return { supabase, actorId: user.id } as const;
}

type Authorized = Awaited<ReturnType<typeof authorizeAdmin>>;

/** 寫入／重置後讓前台快取失效（最遲 60 秒，見 site-settings 同款註解） */
function revalidateSite() {
  revalidateTag(SITE_NAV_TAG, { expire: 60 });
  revalidatePath("/", "layout");
}

/* =============================================================
 * GET — 讀取全站選單
 * ============================================================= */
export async function GET() {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", SITE_NAV_KEY)
      .maybeSingle();
    if (error) return jsonInternal("GET /api/admin/site-nav select", error);

    return jsonOk({ data: coerceNav(data?.value ?? null) });
  } catch (err) {
    return jsonInternal("GET /api/admin/site-nav", err);
  }
}

/* =============================================================
 * POST — 儲存全站選單
 * ============================================================= */
export async function POST(request: Request) {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, actorId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    // 1) 結構驗證（links 3–8 項、href 白名單、label 長度；不合法整套退回）
    const normalized = normalizeNav(body, DEFAULT_NAV);
    if (!normalized.ok) return jsonValidation(normalized.fields);
    const next: SiteNav = normalized.nav;

    // 2) UPSERT
    const { error } = await supabase.from("app_settings").upsert(
      {
        key: SITE_NAV_KEY,
        value: next as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) return jsonInternal("POST /api/admin/site-nav upsert", error);

    // 3) DB 成功後才失效快取
    revalidateSite();

    // 4) T-15 操作日誌（best-effort，失敗不影響主流程，見 lib/audit.ts 檔頭）
    await writeAuditLog(supabase, actorId, "site-nav", "save", "更新導覽選單。");

    return jsonOk({
      data: next,
      message: "選單已儲存，重新載入頁面後生效。",
    });
  } catch (err) {
    return jsonInternal("POST /api/admin/site-nav", err);
  }
}

/* =============================================================
 * DELETE — 回復原廠選單
 * ============================================================= */
export async function DELETE() {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, actorId } = auth;

    const { error } = await supabase.from("app_settings").upsert(
      {
        key: SITE_NAV_KEY,
        value: DEFAULT_NAV as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) return jsonInternal("DELETE /api/admin/site-nav upsert", error);

    revalidateSite();

    // T-15 操作日誌（best-effort，失敗不影響主流程）
    await writeAuditLog(supabase, actorId, "site-nav", "restore", "回復導覽選單原廠設定。");

    return jsonOk({ data: DEFAULT_NAV, message: "已回復原廠選單。" });
  } catch (err) {
    return jsonInternal("DELETE /api/admin/site-nav", err);
  }
}
