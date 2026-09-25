/**
 * src/lib/assets.ts — 公開素材網址與 bucket 前綴
 *
 * Owner：方砚。對齊 SPEC-R6.md §0.5：
 *   公開素材網址 = https://{SUPABASE_PROJECT_HOST}/storage/v1/object/public/site-assets/{path}
 * 任何地方都不許手寫這串網址，一律走 publicAssetUrl()。
 */

import { SUPABASE_URL, isSupabaseConfigured } from "./supabase/env";

/** 各類素材在 site-assets bucket 內的路徑前綴 */
export const ASSET_PREFIX = {
  event: "events",
  logo: "logo",
  hero: "hero",
} as const;

export type AssetKind = "event" | "logo" | "hero" | "run";

/** 把 site-assets 內部的 path 轉成可公開存取的完整網址；未設定 env 或無 path 回傳 null */
export function publicAssetUrl(path: string | null | undefined): string | null {
  if (!path || !isSupabaseConfigured) return null;
  const clean = path.replace(/^\/+/, "");
  return `${SUPABASE_URL}/storage/v1/object/public/site-assets/${clean}`;
}
