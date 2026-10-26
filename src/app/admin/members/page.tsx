import { MemberManager } from "./MemberManager";

export const metadata = { title: "會員管理" };
export const dynamic = "force-dynamic";

/**
 * 後台：會員管理
 *
 * 權限由 src/app/admin/layout.tsx 統一把關（未登入 → 登入頁、非管理員 → 權限不足），
 * 結構與 src/app/admin/coaches/page.tsx 一致。
 *
 * ⚠️ 若尚未執行 supabase/migration-admin-members.sql，
 *    列表會讀取失敗並在頁內顯示錯誤，頁面本身不會壞掉。
 */
export default function AdminMembersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">會員管理</h2>
        <p className="mt-2 text-sm text-white/70">
          檢視會員資料、調整角色與積分。角色決定能否進入後台，積分調整會寫入積分明細。
        </p>
        <p className="mt-1 text-xs text-white/50">
          首次使用請先到 Supabase 執行{" "}
          <code>supabase/migration-admin-members.sql</code>。
        </p>
      </div>

      <MemberManager />
    </div>
  );
}
