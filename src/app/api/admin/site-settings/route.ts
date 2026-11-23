/**
 * /api/admin/site-settings — 網站主題（管理員限定）
 *
 * POST   儲存整包 SiteTheme（23 個欄位）→ 200
 * DELETE 回復原廠設定（只重置 site_theme 一列，不動其他資料）→ 200
 *
 * 契約：SPEC-R6.md §2.6（POST）、§2.7（DELETE）
 * T-15：POST/DELETE 成功後各寫一筆 admin_audit_log（module=site-settings，
 *       action=save/restore；best-effort，見 src/lib/audit.ts）
 * Owner：白客
 *
 * H6：全部包 try/catch，任何情況都回 JSON。
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { assertModuleAccess } from "@/lib/admin-guard";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { DEFAULT_THEME, normalizeTheme, type SiteTheme } from "@/lib/theme";
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

import { SITE_THEME_TAG } from "@/lib/queries";

const SITE_THEME_KEY = "site_theme";
const SITE_ASSETS = "site-assets";

type Supabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;

/** H4：Supabase 設定檢查 → 未登入 401 → 非管理員 403 */
async function authorizeAdmin(opts: { write?: boolean } = {}) {
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

  const denied = await assertModuleAccess(supabase, "theme", opts);
  if (denied) return { res: denied } as const;

  // T-15：actorId 一併回傳（操作日誌的 actor_id = 授權管理員 user.id）
  return { supabase, actorId: user.id } as const;
}

type Authorized = Awaited<ReturnType<typeof authorizeAdmin>>;

/** 圖片物件的存在性檢查（§2.6 第 2 步） */
async function imageExists(supabase: Supabase, path: string): Promise<boolean> {
  const idx = path.lastIndexOf("/");
  const dir = idx === -1 ? "" : path.slice(0, idx);
  const base = path.slice(idx + 1);

  const { data, error } = await supabase.storage.from(SITE_ASSETS).list(dir, {
    search: base,
    limit: 20,
  });

  if (error || !data?.length) return false;
  return data.some((o) => o.name === base);
}

/* =============================================================
 * POST — 儲存網站主題
 * ============================================================= */
export async function POST(request: Request) {
  try {
    const auth = (await authorizeAdmin({ write: true })) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, actorId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    // 【P1-1】必填鍵齊備檢查 —— 必須在 normalizeTheme 之前。
    // normalizeTheme(body, DEFAULT_THEME) 的語義是「缺的補預設」，
    // 所以空 body `{}` 會被補成完整出廠主題再整包 upsert ——
    // 站主改過的品牌名、配色、字體、圖片路徑會不可回復地消失，且回 200。
    // 前端（SettingsForm）送的是完整 SiteTheme（{...form}），不會誤傷；
    // 注意 logo_path / hero_bg_path 允許值為 null，但**鍵必須存在**。
    const bodyRecord = body as Record<string, unknown>;
    const missingTopKeys = Object.keys(DEFAULT_THEME).filter((k) => !(k in bodyRecord));
    if (missingTopKeys.length > 0) {
      return jsonValidation(
        Object.fromEntries(missingTopKeys.map((k) => [k, "缺少此欄位。"])),
        "設定不完整，為避免以預設值覆寫既有設定，此次儲存已取消。請重新載入頁面後再試。"
      );
    }

    // 1) 欄位驗證（缺的補預設，髒的一律退回，不是硬塞進 DB）
    const normalized = normalizeTheme(body, DEFAULT_THEME);
    if (!normalized.ok) return jsonValidation(normalized.fields);
    const next: SiteTheme = normalized.theme;

    // 2) 圖片存在性檢查
    const missing: Record<string, string> = {};
    for (const key of ["logo_path", "hero_bg_path"] as const) {
      const p = next[key];
      if (p && !(await imageExists(supabase, p))) {
        missing[key] = "圖片不存在，請重新上傳。";
      }
    }
    if (Object.keys(missing).length > 0) return jsonValidation(missing);

    // 3) 先讀舊值（用來清掉被換下來的圖片）
    const { data: prev } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", SITE_THEME_KEY)
      .maybeSingle();
    const oldTheme = normalizeTheme(prev?.value ?? {}, DEFAULT_THEME);
    const old: SiteTheme = oldTheme.ok ? oldTheme.theme : DEFAULT_THEME;

    // 4) UPSERT
    const { error } = await supabase.from("app_settings").upsert(
      {
        key: SITE_THEME_KEY,
        value: next as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );

    if (error) return jsonInternal("POST /api/admin/site-settings upsert", error);

    // 5) DB 成功後才清舊圖：best-effort
    //    【P1-1】加「新值非 null 才刪舊檔」——
    //    若 next[k] 是 null（使用者清空、或上游誤送預設值），刪掉舊檔等於
    //    把使用者可能要救回的圖片永久刪除。寧可留一個孤兒檔案（storage 成本幾乎為零），
    //    也不要在「不確定是否真的要換」的情況下刪掉實體檔案。
    const toRemove = (["logo_path", "hero_bg_path"] as const).filter(
      (k) => old[k] && next[k] !== null && old[k] !== next[k]
    );
    if (toRemove.length > 0) {
      const { error: rmErr } = await supabase.storage
        .from(SITE_ASSETS)
        .remove(toRemove.map((k) => old[k] as string));
      if (rmErr) console.warn("[site-settings] 移除舊圖片失敗（可忽略）：", rmErr.message);
    }

    // 6) 讓前台 60 秒快取失效。
    //    Next 16 起 revalidateTag 必須帶第二個參數（cacheLife profile）；
    //    這裡用 { expire: 60 } 維持 SPEC 的「最遲 60 秒」語意。
    //    註：Next 16 提供 read-your-own-writes 的 updateTag()，但它
    //    「只能在 Server Actions 內呼叫」，而本專案禁用 Server Actions（H1），
    //    故這裡語意是 stale-while-revalidate —— 見 SECURITY/交接說明。
    revalidateTag(SITE_THEME_TAG, { expire: 60 });
    revalidatePath("/", "layout");

    // 7) T-15 操作日誌（best-effort，失敗不影響主流程，見 lib/audit.ts 檔頭）
    await writeAuditLog(supabase, actorId, "site-settings", "save", "更新網站主題設定。");

    return jsonOk({
      data: next,
      message: "網站設定已儲存，重新載入頁面後生效。",
    });
  } catch (err) {
    return jsonInternal("POST /api/admin/site-settings", err);
  }
}

/* =============================================================
 * DELETE — 回復原廠設定
 * ============================================================= */
export async function DELETE() {
  try {
    const auth = (await authorizeAdmin({ write: true })) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, actorId } = auth;

    const { error } = await supabase.from("app_settings").upsert(
      {
        key: SITE_THEME_KEY,
        value: DEFAULT_THEME as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );

    if (error) return jsonInternal("DELETE /api/admin/site-settings upsert", error);

    revalidateTag(SITE_THEME_TAG, { expire: 60 });
    revalidatePath("/", "layout");

    // T-15 操作日誌（best-effort，失敗不影響主流程）
    await writeAuditLog(supabase, actorId, "site-settings", "restore", "回復網站主題原廠設定。");

    return jsonOk({ data: DEFAULT_THEME, message: "已回復原廠設定。" });
  } catch (err) {
    return jsonInternal("DELETE /api/admin/site-settings", err);
  }
}
