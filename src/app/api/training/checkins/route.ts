import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** 報名／簽到某一場訓練 */
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

  const { session_id } = (await request.json()) as { session_id?: string };
  if (!session_id)
    return NextResponse.json({ ok: false, error: "缺少場次。" }, { status: 400 });

  const { error } = await supabase.from("training_checkins").upsert(
    { session_id, user_id: user.id, status: "pending" },
    { onConflict: "session_id,user_id", ignoreDuplicates: true }
  );

  if (error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  revalidatePath("/training");
  revalidatePath("/dashboard");

  return NextResponse.json({ ok: true });
}

/** 取消報名（僅限尚未確認） */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  if (!supabase)
    return NextResponse.json({ ok: false, error: "客戶端初始化失敗。" }, { status: 500 });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ ok: false, error: "請先登入。" }, { status: 401 });

  const { session_id } = (await request.json()) as { session_id?: string };
  if (!session_id)
    return NextResponse.json({ ok: false, error: "缺少場次。" }, { status: 400 });

  const { error } = await supabase
    .from("training_checkins")
    .delete()
    .eq("session_id", session_id)
    .eq("user_id", user.id)
    .eq("status", "pending");

  if (error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  revalidatePath("/training");
  revalidatePath("/dashboard");

  return NextResponse.json({ ok: true });
}
