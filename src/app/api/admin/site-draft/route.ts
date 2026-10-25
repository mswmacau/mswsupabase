/**
 * /api/admin/site-draft — 網站內容草稿袋（管理員限定；T-16 MVP）
 *
 * GET    讀取草稿袋（site_content_draft）→ { ok: true, draft }；無草稿 → draft: null
 * POST   儲存草稿袋（只存傳來的分區，逐個過 normalize* 校驗；400 帶欄位錯誤）
 * POST + body { publish: true }
 *        發佈：把「已儲存的草稿袋」逐個走與正式路由相同的 upsert 路徑 +
 *        revalidateTag，成功後清空草稿袋 → { ok: true, published: [...] }
 * DELETE 丟棄草稿（清空草稿袋為 {}）→ 200
 *
 * 契約：主理人範圍裁決（草稿袋 + 管理員預覽 + 三按鈕）；V1 計劃 C11（降級條款）
 * Owner：白客
 *
 * H6：全部包 try/catch，任何情況都回 JSON。
 * 授權：复刻 site-content 的 authorizeAdmin（未登入 401 / 非管理員 403）。
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  DEFAULT_BLOCKS,
  DEFAULT_CONTACT,
  DEFAULT_CONTENT,
  DEFAULT_NAV,
  DEFAULT_PAGES,
  coerceBlocks,
  coerceContact,
  coerceContent,
  coerceNav,
  coercePages,
  normalizeBlocks,
  normalizeContact,
  normalizeContent,
  normalizeNav,
  normalizePages,
} from "@/lib/content";
import {
  DEFAULT_SEO,
  coerceSeo,
  normalizeSeo,
} from "@/lib/seo";
import {
  jsonBadJson,
  jsonForbidden,
  jsonInternal,
  jsonMethodNotAllowed,
  jsonNotConfigured,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { SITE_DRAFT_KEY } from "@/lib/draft";
import {
  SITE_BLOCKS_TAG,
  SITE_CONTACT_TAG,
  SITE_CONTENT_TAG,
  SITE_NAV_TAG,
  SITE_PAGES_TAG,
  SITE_SEO_TAG,
} from "@/lib/queries";

/** 草稿袋的六個分區（固定順序，保證袋內鍵序穩定） */
const SECTION_ORDER = [
  "content",
  "nav",
  "contact",
  "pages",
  "blocks",
  "seo",
] as const;

type SectionKey = (typeof SECTION_ORDER)[number];

/** 分區 → 正式 app_settings 鍵 / 快取 tag / 中文名（日誌摘要用） */
const SECTION_SETTINGS_KEY: Record<SectionKey, string> = {
  content: "site_content",
  nav: "site_nav",
  contact: "site_contact",
  pages: "site_pages",
  blocks: "site_blocks",
  seo: "site_seo",
};

const SECTION_TAG: Record<SectionKey, string> = {
  content: SITE_CONTENT_TAG,
  nav: SITE_NAV_TAG,
  contact: SITE_CONTACT_TAG,
  pages: SITE_PAGES_TAG,
  blocks: SITE_BLOCKS_TAG,
  seo: SITE_SEO_TAG,
};

const SECTION_LABEL: Record<SectionKey, string> = {
  content: "首頁文案",
  nav: "導覽選單",
  contact: "頁尾聯絡",
  pages: "頁面文案",
  blocks: "首頁區塊",
  seo: "SEO",
};

type FieldErrors = Record<string, string>;

/** 寫入端校驗：缺鍵補預設、髒值退回（與各 site-* 路由用的同一個 normalize*） */
function normalizeSection(
  key: SectionKey,
  input: unknown
): { ok: true; value: unknown } | { ok: false; fields: FieldErrors } {
  switch (key) {
    case "content": {
      const r = normalizeContent(input, DEFAULT_CONTENT);
      return r.ok ? { ok: true, value: r.content } : r;
    }
    case "nav": {
      const r = normalizeNav(input, DEFAULT_NAV);
      return r.ok ? { ok: true, value: r.nav } : r;
    }
    case "contact": {
      const r = normalizeContact(input, DEFAULT_CONTACT);
      return r.ok ? { ok: true, value: r.contact } : r;
    }
    case "pages": {
      const r = normalizePages(input, DEFAULT_PAGES);
      return r.ok ? { ok: true, value: r.pages } : r;
    }
    case "blocks": {
      const r = normalizeBlocks(input, DEFAULT_BLOCKS);
      return r.ok ? { ok: true, value: r.blocks } : r;
    }
    case "seo": {
      const r = normalizeSeo(input, DEFAULT_SEO);
      return r.ok ? { ok: true, value: r.seo } : r;
    }
  }
}

/** 讀取端 coerce：DB 髒值 best-effort 回落預設，永不拋錯 */
function coerceSection(key: SectionKey, input: unknown): unknown {
  switch (key) {
    case "content":
      return coerceContent(input);
    case "nav":
      return coerceNav(input);
    case "contact":
      return coerceContact(input);
    case "pages":
      return coercePages(input);
    case "blocks":
      return coerceBlocks(input);
    case "seo":
      return coerceSeo(input);
  }
}

function isSectionKey(key: string): key is SectionKey {
  return (SECTION_ORDER as readonly string[]).includes(key);
}

/** H4：Supabase 設定檢查 → 未登入 401 → 非管理員 403（复刻 site-content） */
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

  return { supabase, actorId: user.id } as const;
}

type Authorized = Awaited<ReturnType<typeof authorizeAdmin>>;

/** 讀草稿袋；空袋／缺鍵／非物件一律回 null（= 無草稿） */
async function readDraftBag(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", SITE_DRAFT_KEY)
    .maybeSingle();
  if (error || !data) return null;

  const bag = data.value;
  if (typeof bag !== "object" || bag === null || Array.isArray(bag)) return null;
  if (Object.keys(bag as Record<string, unknown>).length === 0) return null;
  return bag as Record<string, unknown>;
}

/** 清空草稿袋（upsert 成播種預設值 {}；冪等，不存在會建立） */
async function clearDraftBag(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>
): Promise<{ error: unknown } | null> {
  const { error } = await supabase.from("app_settings").upsert(
    {
      key: SITE_DRAFT_KEY,
      value: {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  );
  return error ? { error } : null;
}

/* =============================================================
 * GET — 讀取草稿袋
 * ============================================================= */
export async function GET() {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase } = auth;

    const bag = await readDraftBag(supabase);
    if (!bag) return jsonOk({ draft: null });

    // coerce 後才回傳（DB 可能被手動改壞；永不拋錯）
    const draft: Record<string, unknown> = {};
    for (const key of SECTION_ORDER) {
      const v = bag[key];
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        draft[key] = coerceSection(key, v);
      }
    }

    return jsonOk({
      draft: Object.keys(draft).length > 0 ? draft : null,
    });
  } catch (err) {
    return jsonInternal("GET /api/admin/site-draft", err);
  }
}

/* =============================================================
 * POST — 儲存草稿袋 或 發佈（body 帶 publish: true）
 * ============================================================= */
export async function POST(request: Request) {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, actorId } = auth;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    /* ---------- 發佈分支：以「已儲存的草稿袋」為準 ---------- */
    if (body.publish === true) {
      const bag = await readDraftBag(supabase);
      if (!bag) return jsonValidation({}, "目前沒有草稿可以發佈。");

      const keys = SECTION_ORDER.filter((k) => k in bag);
      if (keys.length === 0) return jsonValidation({}, "目前沒有草稿可以發佈。");

      // 1) 先全部再驗證一次（DB 值可能被手動改壞）；全過才動 DB
      const fields: FieldErrors = {};
      const normalized: Partial<Record<SectionKey, unknown>> = {};
      for (const key of keys) {
        const r = normalizeSection(key, bag[key]);
        if (r.ok) {
          normalized[key] = r.value;
        } else {
          for (const [f, msg] of Object.entries(r.fields)) {
            fields[`${key}.${f}`] = msg;
          }
        }
      }
      if (Object.keys(fields).length > 0) return jsonValidation(fields);

      // 2) 逐個 upsert 到正式鍵——與各 api/admin/site-* 的 upsert 路徑相同
      //    如實註記：此處非單一事務，若第 N 個 upsert 失敗，前 N-1 個已寫入。
      //    但第 1 步已把全部內容驗證過，正常只會在基礎設施故障時發生；
      //    失敗時回 500，管理員可重試（upsert 冪等，重試安全）。
      for (const key of keys) {
        const { error } = await supabase.from("app_settings").upsert(
          {
            key: SECTION_SETTINGS_KEY[key],
            value: normalized[key] as Record<string, unknown>,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        );
        if (error) {
          return jsonInternal("POST /api/admin/site-draft publish upsert", error);
        }
      }

      // 3) 快取失效（與各 site-* 路由的 revalidateSite() 同效果）
      for (const key of keys) revalidateTag(SECTION_TAG[key], { expire: 60 });
      revalidatePath("/", "layout");

      // 4) 清空草稿袋（發佈的事實已完成；清空失敗只記錄，不翻盤已發佈的結果）
      const clearFail = await clearDraftBag(supabase);
      if (clearFail) {
        console.warn(
          "[site-draft] 發佈後清空草稿袋失敗（不影響已發佈內容）：",
          (clearFail.error as { message?: string })?.message
        );
      }

      // 5) T-15 操作日誌（超出派工單七路由的補充寫入點，如實記錄）
      const labels = keys.map((k) => SECTION_LABEL[k]).join("、");
      await writeAuditLog(supabase, actorId, "site-draft", "publish", `發佈草稿：${labels}。`);

      return jsonOk({
        published: keys,
        message: "草稿已發佈，全站最遲 60 秒生效。",
      });
    }

    /* ---------- 儲存分支：袋內只存傳來的分區（替換語義） ---------- */
    // publish 鍵只在 true 時有意義（上面已分流）；false 時忽略，不當成未知分區
    const sectionKeys = Object.keys(body).filter((k) => k !== "publish");
    if (sectionKeys.length === 0) {
      return jsonValidation({}, "請至少選擇一個分區儲存草稿。");
    }

    const fields: FieldErrors = {};
    const bag: Record<string, unknown> = {};

    // 未知鍵一律退回（防止垃圾資料沉積在袋裡）
    for (const k of sectionKeys) {
      if (!isSectionKey(k)) fields[k] = "未知的分區。";
    }

    // 逐個分區校驗；錯誤鍵加上分區前綴（如 content.hero.title_line1）
    for (const key of SECTION_ORDER) {
      if (!(key in body)) continue;
      const r = normalizeSection(key, body[key]);
      if (r.ok) {
        bag[key] = r.value;
      } else {
        for (const [f, msg] of Object.entries(r.fields)) {
          fields[`${key}.${f}`] = msg;
        }
      }
    }

    if (Object.keys(fields).length > 0) return jsonValidation(fields);

    const { error } = await supabase.from("app_settings").upsert(
      {
        key: SITE_DRAFT_KEY,
        value: bag,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) return jsonInternal("POST /api/admin/site-draft upsert", error);

    // T-15 操作日誌（best-effort，失敗不影響主流程）
    const labels = sectionKeys
      .filter(isSectionKey)
      .map((k) => SECTION_LABEL[k])
      .join("、");
    await writeAuditLog(supabase, actorId, "site-draft", "save-draft", `儲存草稿：${labels}。`);

    return jsonOk({
      draft: bag,
      message: "草稿已儲存。按「預覽」查看效果；按「發佈」讓全站生效。",
    });
  } catch (err) {
    return jsonInternal("POST /api/admin/site-draft", err);
  }
}

/* =============================================================
 * DELETE — 丟棄草稿
 * ============================================================= */
export async function DELETE() {
  try {
    const auth = (await authorizeAdmin()) as Authorized;
    if ("res" in auth) return auth.res;
    const { supabase, actorId } = auth;

    const fail = await clearDraftBag(supabase);
    if (fail) return jsonInternal("DELETE /api/admin/site-draft upsert", fail.error);

    // T-15 操作日誌（best-effort，失敗不影響主流程）
    await writeAuditLog(supabase, actorId, "site-draft", "discard-draft", "丟棄草稿。");

    return jsonOk({ draft: null, message: "草稿已丟棄。" });
  } catch (err) {
    return jsonInternal("DELETE /api/admin/site-draft", err);
  }
}

/** H6：未實作的方法也回 JSON 405（复刻 checkins 路由紀律） */
export async function PUT() {
  return jsonMethodNotAllowed();
}
export async function PATCH() {
  return jsonMethodNotAllowed();
}
