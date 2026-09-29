import { CoachManager } from "./CoachManager";
import { createClient } from "@/lib/supabase/server";
import type { Coach } from "@/lib/queries";

export const metadata = { title: "教練管理" };
export const dynamic = "force-dynamic";

/**
 * 後台：教練管理
 *
 * 用 server client（帶使用者 session）讀取，
 * 因此會走 RLS 的 coaches_admin_all 政策，管理員可讀到全部（含隱藏的）。
 *
 * ⚠️ 若尚未執行 supabase/migration-coaches.sql，coaches 表不存在，
 *    這裡會回傳空陣列，頁面仍可正常顯示並提示，不會壞掉。
 */
export default async function AdminCoachesPage() {
  const supabase = await createClient();
  let coaches: Coach[] = [];

  if (supabase) {
    const { data, error } = await supabase
      .from("coaches")
      .select("id, name, specialty, bio, photo_path, sort_order, is_visible")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(100);

    if (!error && data?.length) {
      coaches = (data as Coach[]).map((c) => ({
        id: c.id,
        name: c.name,
        specialty: c.specialty ?? null,
        bio: c.bio ?? null,
        photo_path: c.photo_path ?? null,
        sort_order: Number(c.sort_order ?? 0),
        is_visible: Boolean(c.is_visible),
      }));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">教練管理</h2>
        <p className="mt-2 text-sm text-white/70">
          上載教練相片並填寫姓名、專長、簡介。勾選「前台顯示」後會出現在教練介紹頁。
        </p>
        <p className="mt-1 text-xs text-white/50">
          首次使用請先到 Supabase 執行 <code>supabase/migration-coaches.sql</code>。
        </p>
      </div>

      <CoachManager coaches={coaches} />
    </div>
  );
}
