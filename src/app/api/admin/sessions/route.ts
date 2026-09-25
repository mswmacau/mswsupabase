import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** 建立／更新訓練場次（以日期為唯一鍵） */
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
    session_date?: string;
    title?: string;
    location?: string;
    start_time?: string;
    end_time?: string;
    capacity?: number;
    note?: string;
  };

  const sessionDate = body.session_date?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate))
    return NextResponse.json({ ok: false, error: "請選擇正確的日期。" }, { status: 400 });

  const start = body.start_time?.trim() || "20:00";
  const end = body.end_time?.trim() || "21:00";
  const capacity = Number(body.capacity ?? 30);

  const { error } = await supabase.from("training_sessions").upsert(
    {
      session_date: sessionDate,
      title: body.title?.trim() || "MSW 定期訓練",
      location: body.location?.trim() || "澳門街健館",
      starts_at: `${sessionDate}T${start}:00`,
      ends_at: `${sessionDate}T${end}:00`,
      capacity: Number.isFinite(capacity) ? capacity : 30,
      note: body.note?.trim() || null,
      status: "open",
    },
    { onConflict: "session_date" }
  );

  if (error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  revalidatePath("/admin/sessions");
  revalidatePath("/training");

  return NextResponse.json({ ok: true, message: `已建立 ${sessionDate} 的訓練場次。` });
}
