/**
 * /api/admin/site-draft/preview — 進入／退出草稿預覽模式（T-16）
 *
 * GET                     進入預覽：enable Next draft mode → 302 跳 /preview
 * GET ?exit=1             退出預覽：disable draft mode → 302 跳 /admin/content
 *
 * 用途：管理員在內容頁按「預覽」按鈕時由前端開新視窗打這個端點；
 *       it sets Next's preview cookie（__next_preview_data），隨後 /preview
 *       頁與首頁的六個 getter 經 getDraftOverride() 讀到草稿值。
 *
 * 授權紀律（复刻 site-draft 主路由）：
 *   - 進入：未登入 401 / 非管理員 403（JSON，H6）
 *   - 退出：不需授權——它只清除呼叫者自己瀏覽器上的 preview cookie，
 *     不讀寫任何資料（等同登出行為）；任何訪客呼叫都只有自己的 cookie 受影響
 *
 * Owner：白客
 */

import { draftMode } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  jsonForbidden,
  jsonInternal,
  jsonNotConfigured,
  jsonUnauthenticated,
} from "@/lib/api";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const exit = url.searchParams.get("exit") === "1";

  /* ---------- 退出：只清自己的 cookie，不需授權 ---------- */
  if (exit) {
    (await draftMode()).disable();
    return NextResponse.redirect(new URL("/admin/content", request.url));
  }

  /* ---------- 進入：H4 授權（未登入 401 / 非管理員 403） ---------- */
  try {
    if (!isSupabaseConfigured) return jsonNotConfigured();

    const supabase = await createClient();
    if (!supabase) return jsonNotConfigured();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return jsonUnauthenticated();

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role !== "admin") return jsonForbidden();

    (await draftMode()).enable();
    return NextResponse.redirect(new URL("/preview", request.url));
  } catch (err) {
    // 理論上不會到這裡（draftMode enable 只動 cookie）；如實回 JSON 500
    return jsonInternal("GET /api/admin/site-draft/preview", err);
  }
}
