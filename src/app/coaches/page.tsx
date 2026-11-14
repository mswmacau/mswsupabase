import type { Metadata } from "next";
import {
  getSiteContent,
  getSitePages,
  getVisibleCoaches,
} from "@/lib/queries";
import { publicAssetUrl } from "@/lib/assets";
import { BrandIntro } from "@/components/BrandIntro";
/* 公開頁視覺層級語彙（色帶 / 抬頭節奏 / 觸控 44 / 白圈 focus） */
import "../public-ui.css";

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
 *
 * 2026-10：站主要求「將關於我們移到教練團隊頁面的下方」，因此頁面順序為
 * 「教練團隊內容 → 關於我們」。關於我們重用首頁同一個 `BrandIntro` 元件
 * （四段文案讀 site_content.about，與首頁同源，版式不改寫），該元件本身
 * 帶 `id="about"`，`/coaches#about` 可直接定位。
 */
export default async function CoachesPage() {
  const [coaches, pages, content] = await Promise.all([
    getVisibleCoaches(50),
    getSitePages(),
    getSiteContent(),
  ]);
  const t = pages.coaches;

  return (
    <>
      <section className="pub-shell pub-band-0 relative overflow-hidden border-b border-ink-line">
        <div className="grid-lines absolute inset-0" />
        <div className="noise-overlay" />

        {/* 上內距必須大於 fixed Nav 的高度（手機 64px／桌面 80px），
            否則頁面標題會被導覽列蓋住（實測 390：pt-48 時 h1 被切掉一半）。 */}
        <div className="container-msw relative pb-12 pt-20 md:pb-20 md:pt-24">
          <h1 className="display-xl">{t.page_title}</h1>
          {/*
            引言段落：站主表示將向教練及活動負責人確認後再提供，
            因此在提供前不填入任何文字（避免編造文案）。
          */}
        </div>
      </section>

      <section className="pub-band-1">
        <div className="container-msw pub-shell pub-pad">
        {coaches.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 px-6 py-12 text-center">
            <p className="text-sm text-white/70">{t.empty_state}</p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 md:gap-8 lg:grid-cols-3">
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
        </div>
      </section>

      {/* ===== 關於我們（原 /about 主要內容，搬到你正在看的這一頁底部）=====
          BrandIntro 自帶 <section id="about">，/coaches#about 由它定位，
          因此外層不再重複掛 id。BrandIntro 內建 section-pad
          （padding-block: var(--space-section, 80px)），用負上邊距把區塊標題
          與主敘述的間距收斂到與站內其他區塊一致的節奏，避免標題與內文之間
          留一大片空白。 */}
      <section className="pub-shell relative border-t border-ink-line">
        <div className="container-msw pt-12 md:pt-16">
          <span className="eyebrow">About / 關於我們</span>
          <h2 className="display-xl mt-3">關於我們</h2>
        </div>
        {/* 原本這裡用 -mt-14 把 BrandIntro 往上拉，結果 BrandIntro 自己的
            pub-band-0 底色把「關於我們」這個 h2 整塊蓋住（剩下不到 12px 的殘影），
            視覺上像「這一頁沒有區塊標題」。改成不再負上邊距：由 BrandIntro 的
            pub-pad（手機 56px）自己提供標題與內文的間距，層級才讀得出來。 */}
        <BrandIntro about={content.about} />
      </section>
    </>
  );
}
