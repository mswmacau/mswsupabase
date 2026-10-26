import { MemberManager } from "./MemberManager";

export const metadata = { title: "會員管理" };
export const dynamic = "force-dynamic";

/**
 * 後台：會員管理（Server Component 外殼）
 *
 * 權限由 src/app/admin/layout.tsx 統一把關（未登入 → 登入頁、非管理員 → 權限不足），
 * 與 src/app/admin/coaches/page.tsx 結構一致。
 *
 * 所有資料操作都在 MemberManager（client）內打 /api/admin/members，
 * 不在 Server Component 直接查：改角色／狀態需要 security definer RPC，
 * 統一走 API 才能對齊錯誤訊息與稽核紀錄。
 */
export default function AdminMembersPage() {
  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h2 className="text-xl font-bold">會員管理</h2>
        <p className="mt-2 text-sm text-white/70">
          檢視會員資料與活動統計，調整角色、狀態與帳號。角色決定能否進入後台。
        </p>
      </div>

      <MemberManager />
    </div>
  );
}
