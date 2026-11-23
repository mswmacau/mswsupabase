import { revalidatePath } from "next/cache";
import { assertModuleAccess } from "@/lib/admin-guard";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { writeAuditLog } from "@/lib/audit";
import {
  jsonBadJson,
  jsonDbError,
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

async function requireAdmin(opts: { write?: boolean } = {}) {
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

  const denied = await assertModuleAccess(supabase, "coaches", opts);
  if (denied) return { error: denied as Response } as const;

  // actorId 給 admin_audit_log 用：教練資料直接顯示在公開的 /coaches
  // （含頁尾的「關於我們」區塊；/about 已下架為永久轉址，不必再 revalidate）
  return { supabase, actorId: user.id } as const;
}

function revalidateCoachPages() {
  revalidatePath("/coaches");
  revalidatePath("/admin/coaches");
}

export async function POST(request: Request) {
  try {
    const guard = await requireAdmin({ write: true });
    if (guard.error) return guard.error;
    const { supabase, actorId } = guard;

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
      if (error) return jsonDbError("POST /api/admin/coaches update", error);
      revalidateCoachPages();
      await writeAuditLog(supabase, actorId, "coaches", "update", `更新教練「${name}」`);
      return jsonOk({ message: "教練資料已更新。", id });
    }

    // 新增
    const { data, error } = await supabase
      .from("coaches")
      .insert(payload)
      .select("id")
      .maybeSingle();
    if (error) return jsonDbError("POST /api/admin/coaches insert", error);
    revalidateCoachPages();
    await writeAuditLog(supabase, actorId, "coaches", "create", `新增教練「${name}」`);
    return jsonOk({ message: "教練已新增。", id: data?.id ?? null });
  } catch {
    return jsonErr("伺服器錯誤，請稍後再試。", "INTERNAL", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const guard = await requireAdmin({ write: true });
    if (guard.error) return guard.error;
    const { supabase, actorId } = guard;

    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return jsonValidation({}, "缺少教練 id。");

    // 稽核摘要用教練名稱（不寫 UUID）；查不到就退回通用描述
    let coachLabel = "未知教練";
    try {
      const { data: coachRow } = await supabase
        .from("coaches")
        .select("name")
        .eq("id", id)
        .maybeSingle();
      coachLabel =
        ((coachRow as { name?: string | null } | null)?.name ?? "").trim() || coachLabel;
    } catch {
      /* 退回通用描述 */
    }

    const { error } = await supabase.from("coaches").delete().eq("id", id);
    if (error) return jsonDbError("DELETE /api/admin/coaches delete", error);

    revalidateCoachPages();
    // 摘要只留 id：刪除後已查不到姓名，硬查一次反而多一次失敗點
    await writeAuditLog(supabase, actorId, "coaches", "delete", `刪除教練「${coachLabel}」`);
    return jsonOk({ message: "教練已刪除。" });
  } catch {
    return jsonErr("伺服器錯誤，請稍後再試。", "INTERNAL", 500);
  }
}

export async function GET() {
  // 先鑑權再回 405：與 events/route.ts 的處理一致。
  // 匿名請求應該得到 401（未登入），而不是 405（不支援此方法）——
  // 405 會讓未登入者知道「這個端點存在但方法不對」，屬於不必要的信息洩漏；
  // 順序反了也會讓「權限測試」誤判（401 與 405 是兩種不同的結論）。
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;
  return jsonMethodNotAllowed();
}

export async function PUT() {
  return jsonMethodNotAllowed();
}
