import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** 批量發券（管理員） */
export async function POST(request: Request) {
  if (!isSupabaseConfigured)
    return NextResponse.json({ ok: false, error: "尚未連接 Supabase。" }, { status: 400 });

  const supabase = await createClient();
  if (!supabase)
    return NextResponse.json({ ok: false, error: "客戶端初始化失敗。" }, { status: 500 });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ ok: false, error: "請先登入。" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin")
    return NextResponse.json({ ok: false, error: "權限不足。" }, { status: 403 });

  const body = (await request.json()) as {
    user_ids?: string[];
    title?: string;
    description?: string;
    month?: string | null;
    days?: number;
  };

  const userIds = (body.user_ids ?? []).filter(Boolean);
  if (!userIds.length)
    return NextResponse.json({ ok: false, error: "請至少選擇一位會員。" }, { status: 400 });

  const days = Number(body.days ?? 90);

  const { error } = await supabase.rpc("issue_coupons", {
    p_user_ids: userIds,
    p_title: body.title?.trim() || "MSW 專屬優惠券",
    p_desc: body.description?.trim() || null,
    p_month: body.month?.trim() || null,
    p_days: Number.isFinite(days) ? days : 90,
  });

  if (error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  revalidatePath("/admin/monthly");
  revalidatePath("/admin/coupons");
  revalidatePath("/admin");

  return NextResponse.json({
    ok: true,
    message: `已發放 ${userIds.length} 張優惠券。`,
  });
}

/** 核銷優惠券 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  if (!supabase)
    return NextResponse.json({ ok: false, error: "客戶端初始化失敗。" }, { status: 500 });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ ok: false, error: "請先登入。" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin")
    return NextResponse.json({ ok: false, error: "權限不足。" }, { status: 403 });

  const { code } = (await request.json()) as { code?: string };
  if (!code)
    return NextResponse.json({ ok: false, error: "請輸入優惠券代碼。" }, { status: 400 });

  const { error } = await supabase.rpc("redeem_coupon", { p_code: code.trim() });
  if (error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  revalidatePath("/admin/coupons");
  return NextResponse.json({ ok: true, message: `優惠券 ${code} 已核銷。` });
}
