import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** 審核跑步提交：通過 → 加分 + 累加里程 + 檢查月度達標自動發券 */
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

  const { submission_id, approve, admin_note } = (await request.json()) as {
    submission_id?: string;
    approve?: boolean;
    admin_note?: string;
  };

  if (!submission_id)
    return NextResponse.json({ ok: false, error: "缺少提交編號。" }, { status: 400 });

  const { data, error } = await supabase.rpc("review_run_submission", {
    p_submission_id: submission_id,
    p_approve: Boolean(approve),
    p_admin_note: admin_note?.trim() || null,
  });

  if (error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  revalidatePath("/admin/runs");
  revalidatePath("/admin");
  revalidatePath("/admin/monthly");
  revalidatePath("/leaderboard");

  return NextResponse.json({
    ok: true,
    monthly_awarded: Boolean((data as { monthly_awarded?: boolean } | null)?.monthly_awarded),
  });
}
