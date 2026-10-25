/**
 * /api/admin/site-blocks — 首頁區塊顯示設定（管理員限定）
 *
 * GET    讀取 site_blocks（DB 無值 → 回落預設）→ { ok: true, data }
 * POST   儲存整包 SiteBlocks → 200；驗證失敗 → 400（fields），DB 不寫
 *       （id 不在白名單／visible 區塊 < 3／order 重複或越界／數量非 8）
 * DELETE 回復全顯預設（只重置 site_blocks 一列，不動其他資料）→ 200
 *
 * 契約：計劃 V2 §8.1（site-blocks 為 V2 新增路由）
 * T-15：POST/DELETE 成功後各寫一筆 admin_audit_log（module=site-blocks，
 *       action=save/restore；best-effort，見 src/lib/audit.ts）
 * Owner：白客
 *
 * H6：全部包 try/catch，任何情況都回 JSON。
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { DEFAULT_BLOCKS, coerceBlocks, normalizeBlocks, type SiteBlocks } from "@/lib/content";
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

import { SITE_BLOCKS_TAG } from "@/lib/queries";

const SITE_BLOCKS_KEY = "site_blocks";

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
  revalidateTag(SITE_BLOCKS_TAG, { expire: 60 });
  revalidatePath("/", "layout");
}

/* =============================================================
 * GET — 讀取首頁區塊設定
 * ============================================================= */
export async function GET() {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", SITE_BLOCKS_KEY)
      .maybeSingle();
    if (error) return jsonInternal("GET /api/admin/site-blocks select", error);

    return jsonOk({ data: coerceBlocks(data?.value ?? null) });
  } catch (err) {
    return jsonInternal("GET /api/admin/site-blocks", err);
  }
}

/* =============================================================
 * POST — 儲存首頁區塊設定
 * ============================================================= */
export async function POST(request: Request) {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, actorId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    // 1) 區塊驗證（id 白名單、剛好 8 個、visible ≥ 3、order 唯一 1–8）
    const normalized = normalizeBlocks(body, DEFAULT_BLOCKS);
    if (!normalized.ok) return jsonValidation(normalized.fields);
    const next: SiteBlocks = normalized.blocks;

    // 2) UPSERT
    const { error } = await supabase.from("app_settings").upsert(
      {
        key: SITE_BLOCKS_KEY,
        value: next as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) return jsonInternal("POST /api/admin/site-blocks upsert", error);

    // 3) DB 成功後才失效快取
    revalidateSite();

    // 4) T-15 操作日誌（best-effort，失敗不影響主流程，見 lib/audit.ts 檔頭）
    await writeAuditLog(supabase, actorId, "site-blocks", "save", "更新首頁區塊設定。");

    return jsonOk({
      data: next,
      message: "首頁區塊設定已儲存，重新載入頁面後生效。",
    });
  } catch (err) {
    return jsonInternal("POST /api/admin/site-blocks", err);
  }
}

/* =============================================================
 * DELETE — 回復全顯預設
 * ============================================================= */
export async function DELETE() {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, actorId } = auth;

    const { error } = await supabase.from("app_settings").upsert(
      {
        key: SITE_BLOCKS_KEY,
        value: DEFAULT_BLOCKS as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) return jsonInternal("DELETE /api/admin/site-blocks upsert", error);

    revalidateSite();

    // T-15 操作日誌（best-effort，失敗不影響主流程）
    await writeAuditLog(supabase, actorId, "site-blocks", "restore", "回復首頁區塊全顯預設。");

    return jsonOk({ data: DEFAULT_BLOCKS, message: "已回復全顯預設。" });
  } catch (err) {
    return jsonInternal("DELETE /api/admin/site-blocks", err);
  }
}
