import { MemberManager } from "./MemberManager";
import { getAdminAccess } from "@/app/admin/_components/adminAccess";
import { isReadOnly } from "@/components/adminModules";
import { ReadOnlyNotice } from "@/app/admin/_components/ReadOnlyNotice";

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
 *
 * P1-1 深連結：`?member=<uuid>&action=correct-km`
 * 由 /admin/review 與 /admin/runs 的「更正里程」帶進來。
 * 在 server 端讀 searchParams 再以 props 傳給 client，比讓 client 用
 * useSearchParams 好：不必為了一個查詢參數加 Suspense 邊界，
 * 也不會有「先渲染列表、再跳開抽屜」的閃動。
 */
export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string; action?: string }>;
}) {
  /* 第二級管理員：members 是唯讀模組 → 頂部提示 + 所有寫入入口不渲染 */
  const access = await getAdminAccess();
  const readOnly = isReadOnly(access, "members");

  const params = await searchParams;
  const memberId = (params.member ?? "").trim();
  // 只認得一個動作；其他值一律當「只開抽屜」，不猜使用者意思
  const action = params.action === "correct-km" ? "correct-km" : null;

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h2 className="text-xl font-bold">會員管理</h2>
        <p className="mt-2 text-sm text-white/70">
          角色決定能否進入後台。
          標記為「測試帳號」的會員不會出現在公開排行榜與站統計，但帳號、積分與里程都保留。
        </p>
      </div>

      {readOnly ? <ReadOnlyNotice /> : null}

      <MemberManager
        initialMemberId={memberId || null}
        initialAction={action}
        readOnly={readOnly}
      />
    </div>
  );
}
