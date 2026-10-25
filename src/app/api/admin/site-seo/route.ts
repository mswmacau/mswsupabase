/**
 * /api/admin/site-seo — SEO metadata（管理員限定）
 *
 * GET    讀取 site_seo（DB 無值 → 回落預設）→ { ok: true, data }
 * POST   儲存整包 SiteSeo → 200；欄位不合法 → 400（fields），DB 不寫
 * DELETE 回復原廠 SEO 設定（只重置 site_seo 一列，不動其他資料）→ 200
 *
 * 契約：計劃 V2 §8.1（site-seo 沿用 V1 路由規格）+ §7.1（site_seo 鍵）
 * T-15：POST/DELETE 成功後各寫一筆 admin_audit_log（module=site-seo，
 *       action=save/restore；best-effort，見 src/lib/audit.ts）
 * Owner：白客
 *
 * H6：全部包 try/catch，任何情況都回 JSON。
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { coerceSeo, DEFAULT_SEO, normalizeSeo, type SiteSeo } from "@/lib/seo";
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

import { SITE_SEO_TAG } from "@/lib/queries";

const SITE_SEO_KEY = "site_seo";

/** H4：Supabase 設定檢查 → 未登入 401 → 非管理員 403（复刻 site-pages） */
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

/** 寫入／重置後讓前台快取失效（最遲 60 秒，見 site-pages 同款註解） */
function revalidateSite() {
  revalidateTag(SITE_SEO_TAG, { expire: 60 });
  revalidatePath("/", "layout");
}

/* =============================================================
 * GET — 讀取 SEO 設定
 * ============================================================= */
export async function GET() {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", SITE_SEO_KEY)
      .maybeSingle();
    if (error) return jsonInternal("GET /api/admin/site-seo select", error);

    return jsonOk({ data: coerceSeo(data?.value ?? null) });
  } catch (err) {
    return jsonInternal("GET /api/admin/site-seo", err);
  }
}

/* =============================================================
 * POST — 儲存 SEO 設定
 * ============================================================= */
export async function POST(request: Request) {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, actorId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    // 1) 欄位驗證（字數上限、OG 路徑格式、寬高整數；不合法退回）
    const normalized = normalizeSeo(body, DEFAULT_SEO);
    if (!normalized.ok) return jsonValidation(normalized.fields);
    const next: SiteSeo = normalized.seo;

    // 2) UPSERT
    const { error } = await supabase.from("app_settings").upsert(
      {
        key: SITE_SEO_KEY,
        value: next as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) return jsonInternal("POST /api/admin/site-seo upsert", error);

    // 3) DB 成功後才失效快取
    revalidateSite();

    // 4) T-15 操作日誌（best-effort，失敗不影響主流程，見 lib/audit.ts 檔頭）
    await writeAuditLog(supabase, actorId, "site-seo", "save", "更新 SEO 設定。");

    return jsonOk({
      data: next,
      message: "SEO 設定已儲存，重新載入頁面後生效。",
    });
  } catch (err) {
    return jsonInternal("POST /api/admin/site-seo", err);
  }
}

/* =============================================================
 * DELETE — 回復原廠 SEO 設定
 * ============================================================= */
export async function DELETE() {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, actorId } = auth;

    const { error } = await supabase.from("app_settings").upsert(
      {
        key: SITE_SEO_KEY,
        value: DEFAULT_SEO as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) return jsonInternal("DELETE /api/admin/site-seo upsert", error);

    revalidateSite();

    // T-15 操作日誌（best-effort，失敗不影響主流程）
    await writeAuditLog(supabase, actorId, "site-seo", "restore", "回復 SEO 原廠設定。");

    return jsonOk({ data: DEFAULT_SEO, message: "已回復原廠 SEO 設定。" });
  } catch (err) {
    return jsonInternal("DELETE /api/admin/site-seo", err);
  }
}
