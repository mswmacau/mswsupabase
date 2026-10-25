import type { Metadata } from "next";
import { getVisibleCoaches, getSitePages } from "@/lib/queries";
import { publicAssetUrl } from "@/lib/assets";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const pages = await getSitePages();
  return { title: pages.coaches.page_title };
}

/**
 * 前台：教練介紹頁
 *
 * ⚠️ 文案凍結：教練姓名、專長、簡介一律由後台（/admin/coaches）填入，
 *    本站不預先寫入任何教練資料。尚未填寫時顯示「即將公佈／即將更新」
 *    佔位，不會編造教練姓名或資歷。
 *
 * 尚未執行 migration-coaches.sql 時，getVisibleCoaches() 會回傳空陣列，
 * 頁面正常顯示空狀態，不會壞掉。
 */
export default async function CoachesPage() {
  const [coaches, pages] = await Promise.all([
    getVisibleCoaches(50),
    getSitePages(),
  ]);
  const t = pages.coaches;

  return (
    <>
      <section className="relative overflow-hidden border-b border-ink-line">
        <div className="grid-lines absolute inset-0" />
        <div className="noise-overlay" />

        <div className="container-msw relative py-16 md:py-24">
          <h1 className="display-xl mt-5">{t.page_title}</h1>
          {/*
            引言段落：站主表示將向教練及活動負責人確認後再提供，
            因此在提供前不填入任何文字（避免編造文案）。
          */}
        </div>
      </section>

      <section className="container-msw py-14 md:py-20">
        {coaches.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 px-6 py-16 text-center">
            <p className="text-sm text-white/70">{t.empty_state}</p>
          </div>
        ) : (
          <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {coaches.map((c) => {
              const img = publicAssetUrl(c.photo_path);
              return (
                <li
                  key={c.id}
                  className="fx-weight-card flex flex-col overflow-hidden border border-ink-line bg-ink-soft"
                >
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img}
                      alt={c.name}
                      width={800}
                      height={800}
                      decoding="async"
                      className="aspect-[3/4] w-full object-cover"
                    />
                  ) : (
                    <div className="grid aspect-[3/4] w-full place-items-center bg-[var(--color-surface-avatar)] px-4 text-center text-xs text-white/45">
                      相片待上載
                    </div>
                  )}

                  <div className="flex flex-1 flex-col p-5">
                    <h2 className="text-lg font-extrabold">{c.name}</h2>
                    {c.specialty && (
                      <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-vital-bright">
                        {c.specialty}
                      </p>
                    )}
                    <p className="mt-3 text-sm leading-relaxed text-white/75">
                      {c.bio?.trim() ? c.bio : "教練簡介即將更新。"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
