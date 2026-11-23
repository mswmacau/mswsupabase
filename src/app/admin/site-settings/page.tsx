import { getSiteTheme } from "@/lib/queries";
import { SettingsForm } from "./SettingsForm";
import { AdminDeniedCard } from "@/app/admin/_components/AdminDeniedCard";
import { getAdminAccess } from "@/app/admin/_components/adminAccess";
import { canView, MODULE_LABELS } from "@/components/adminModules";

export const metadata = { title: "網站設定" };
export const dynamic = "force-dynamic";

export default async function SiteSettingsPage() {
  /* 兩級管理員：none 模組直接給拒訪卡（server 端 early return，不查資料、不閃現） */
  const access = await getAdminAccess();
  if (!canView(access, "theme")) return <AdminDeniedCard moduleLabel={MODULE_LABELS.theme} />;

  const theme = await getSiteTheme();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">網站設定</h2>
        <p className="mt-2 text-sm text-white/75">
          調整品牌名稱、Logo、主色、字體與版面密度。所有修改會即時套用至全站，
          也可隨時「回復原廠設定」。
        </p>
      </div>
      <SettingsForm initialTheme={theme} />
    </div>
  );
}
