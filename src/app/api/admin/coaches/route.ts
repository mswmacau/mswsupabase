import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  jsonBadJson,
  jsonErr,
  jsonForbidden,
  jsonMethodNotAllowed,
  jsonNotConfigured,
  jsonOk,
  jsonUnauthenticated,
  jsonValidation,
  readJson,
} from "@/lib/api";

/**
 * 教練資料 CRUD（僅管理員）
 *
 * 對應需求：站主要上載教練相片並填寫教練資料（姓名、專長、簡介等），
 * 於前台「教練介紹」頁展示。
 *
 * 沿用既有後台 API 的安全模式：
 *  - isSupabaseConfigured 先行檢查
 *  - auth.getUser() → profiles.role 必須是 admin
 *  - readJson() 防畸形 body（避免裸奔 500 空 body）
 *  - 全程 try/catch
 *
 * ⚠️ 需先執行 supabase/migration-coaches.sql 建立 coaches 表，
 *    否則這裡會回傳資料庫錯誤。
 */

/** 安全取字串（去除前後空白） */
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 安全取整數並夾在 [min, max] */
function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

async function requireAdmin() {
  if (!isSupabaseConfigured) return { error: jsonNotConfigured() as Response } as const;

  const supabase = await createClient();
  if (!supabase) return { error: jsonErr("客戶端初始化失敗。", "INTERNAL", 500) as Response } as const;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: jsonUnauthenticated() as Response } as const;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") return { error: jsonForbidden() as Response } as const;

  return { supabase } as const;
}

function revalidateCoachPages() {
  revalidatePath("/coaches");
  revalidatePath("/about");
  revalidatePath("/admin/coaches");
}

export async function POST(request: Request) {
  try {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;
    const supabase = guard.supabase;

    const body = await readJson(request);
    if (!body) return jsonBadJson();

    const name = text(body.name);
    if (!name) return jsonValidation({}, "請填寫教練姓名。");
    if (name.length > 60) return jsonValidation({}, "教練姓名過長（上限 60 字）。");

    const payload = {
      name,
      specialty: text(body.specialty).slice(0, 120) || null,
      bio: text(body.bio).slice(0, 2000) || null,
      photo_path: text(body.photo_path) || null,
      sort_order: clampInt(body.sort_order, 0, -99999, 99999),
      is_visible: body.is_visible !== false,
    };

    const id = text(body.id);

    if (id) {
      // 更新
      const { error } = await supabase
        .from("coaches")
        .update(payload)
        .eq("id", id);
      if (error) return jsonErr(error.message, "DB", 500);
      revalidateCoachPages();
      return jsonOk({ message: "教練資料已更新。", id });
    }

    // 新增
    const { data, error } = await supabase
      .from("coaches")
      .insert(payload)
      .select("id")
      .maybeSingle();
    if (error) return jsonErr(error.message, "DB", 500);
    revalidateCoachPages();
    return jsonOk({ message: "教練已新增。", id: data?.id ?? null });
  } catch {
    return jsonErr("伺服器錯誤，請稍後再試。", "INTERNAL", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const guard = await requireAdmin();
    if (guard.error) return guard.error;
    const supabase = guard.supabase;

    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return jsonValidation({}, "缺少教練 id。");

    const { error } = await supabase.from("coaches").delete().eq("id", id);
    if (error) return jsonErr(error.message, "DB", 500);

    revalidateCoachPages();
    return jsonOk({ message: "教練已刪除。" });
  } catch {
    return jsonErr("伺服器錯誤，請稍後再試。", "INTERNAL", 500);
  }
}

export async function GET() {
  return jsonMethodNotAllowed();
}

export async function PUT() {
  return jsonMethodNotAllowed();
}
