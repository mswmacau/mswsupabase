import { getSiteTheme } from "@/lib/queries";
import { SettingsForm } from "./SettingsForm";

export const metadata = { title: "網站設定" };
export const dynamic = "force-dynamic";

export default async function SiteSettingsPage() {
  const theme = await getSiteTheme();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">網站設定</h2>
        <p className="mt-2 text-sm text-white/55">
          調整品牌名稱、Logo、主色、字體與版面密度。所有修改會即時套用至全站，
          也可隨時「回復原廠設定」。
        </p>
      </div>
      <SettingsForm initialTheme={theme} />
    </div>
  );
}
