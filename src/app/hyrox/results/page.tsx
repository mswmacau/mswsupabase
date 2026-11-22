/**
 * src/app/hyrox/results/page.tsx — HYROX 完賽排行榜（F-01 / F-03）
 *
 * Server Component（§1.5-⑤：公開榜無 API）：
 *   · 類別 chips   → getHyroxDivisions()（anon＋60s 快取）
 *   · 榜體         → getHyroxResultsBoard(division)（anon＋60s 快取，只讀
 *                    hyrox_results_public 檢視——欄位白名單，無 user_id／電話／email）
 *   · 我的提交     → getMyHyroxResults(profile.id)（帶 cookie，只回本人）
 *
 * 頁面決策 §1.6（390 基準）：
 *   · chips 是 `?d=<code>` 連結（無 JS 可切換；不做成 JS tab）
 *   · 榜體不做橫向滾動表格：前 3 名大卡 ＋ 第 4 名起清單行（行高 ≥44px）
 *   · 隊伍列：隊名主文字、隊友名第二行小字（Q-2 已拍板：隊友姓名顯示）
 *   · 1440：左 2/3 榜體、右 1/3 粘性卡（我的提交＋提交 CTA）
 *
 * 降級（§1.5-⑥）：migration 未跑時三個查詢都回 [] →
 *   無 chips、榜體顯示空狀態卡（§5-8 凍結文案），絕不出 500。
 *
 * 文案：§5 凍結清單逐字（頁標題／空狀態／我的提交標題…），不得改寫。
 */

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock3, LogIn, Medal, Trophy } from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/server";
import {
  getHyroxDivisions,
  getHyroxResultsBoard,
  getMyHyroxResults,
} from "@/lib/queries";
import { ResultSubmitForm } from "@/components/hyrox/ResultSubmitForm";
import {
  MyHyroxResults,
  formatFinish,
  type MyResultRow,
} from "@/components/hyrox/MyHyroxResults";
import "../../public-ui.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // §5-1 凍結文案
  title: "HYROX 完賽排行榜",
  description:
    "按比賽類別查看會員的 HYROX 完賽成績；同類別內時間最快者在前。",
};

export default async function HyroxResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string | string[] }>;
}) {
  const params = await searchParams;
  const dParam = Array.isArray(params.d) ? params.d[0] : params.d;

  const divisions = await getHyroxDivisions();
  // ?d= 無效（停用／不存在）時退回第一個類別，不出空白頁
  const active =
    divisions.find((x) => x.code === dParam) ?? divisions[0] ?? null;

  const [profile, board] = await Promise.all([
    getCurrentProfile(),
    active ? getHyroxResultsBoard(active.code) : Promise.resolve([]),
  ]);
  const mine: MyResultRow[] = profile
    ? await getMyHyroxResults(profile.id)
    : [];

  const podium = board.slice(0, 3);
  const rest = board.slice(3);

  return (
    <div className="pub-shell pb-16 pt-20 md:pb-20 md:pt-24">
      {/* ===== Hero（§5-1 凍結文案） ===== */}
      <section className="relative overflow-hidden">
        <div className="grid-lines absolute inset-0" />
        <div className="noise-overlay" />
        <div
          className="pointer-events-none absolute -right-[18%] -top-[40%] h-[520px] w-[520px] rounded-full blur-[130px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-vital) 65%, transparent), transparent 66%)",
            opacity: 0.32,
          }}
        />

        <div className="container-msw relative z-10 pb-8 pt-8 md:pb-14 md:pt-12">
          <p className="eyebrow">HYROX Results</p>
          <h1 className="display-xl mt-6 break-words">
            <span className="block text-white">HYROX</span>
            <span className="mt-1 block text-vital-bright">完賽排行榜</span>
          </h1>
          <p className="mt-5 max-w-xl break-words text-sm leading-relaxed text-white/65 md:text-base">
            同類別內時間最快者在前；成績經後台核對截圖後才會上榜。
          </p>
        </div>
      </section>

      {/* ===== 類別 chips（橫向滑動；無 JS 也可切換的 ?d= 連結） ===== */}
      <section className="container-msw">
        <div
          role="group"
          aria-label="比賽類別"
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {divisions.map((dv) => {
            const isActive = active?.code === dv.code;
            return (
              <Link
                key={dv.code}
                href={`/hyrox/results?d=${dv.code}`}
                aria-current={isActive ? "true" : undefined}
                className={`stat-figure min-h-11 shrink-0 px-4 py-2.5 text-sm transition ${
                  isActive
                    ? "slab bg-vital text-white"
                    : "text-white/60 hover:text-white"
                }`}
              >
                {dv.label}
              </Link>
            );
          })}
        </div>
      </section>

      <div className="container-msw mt-8 grid gap-8 lg:grid-cols-3 lg:gap-10">
        {/* ===== 榜體（左 2/3） ===== */}
        <section className="min-w-0 lg:col-span-2">
          {active && (
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line-hairline-strong)] pb-4">
              <h2 className="text-2xl font-black tracking-tight md:text-3xl">
                {active.label}
              </h2>
              <span className="text-xs text-white/45">
                共 {board.length} 筆已確認成績
              </span>
            </div>
          )}

          {board.length === 0 ? (
            // §5-8 凍結文案（類別未上架時 active=null，同樣走這張卡）
            <div className="mt-6 card-dark border-dashed p-8 text-center">
              <Trophy size={26} className="mx-auto text-white/35" />
              <p className="mt-4 text-sm leading-relaxed text-white/70">
                這個類別暫時沒有已確認的完賽成績。提交你的成績，經後台確認後就會上榜。
              </p>
            </div>
          ) : (
            <>
              {/* 前 3 名大卡（#1 高亮） */}
              {podium.length > 0 && (
                <ul className="mt-6 grid gap-3 sm:grid-cols-3">
                  {podium.map((row) => (
                    <li
                      key={row.id}
                      className={`card-dark relative overflow-hidden p-5 ${
                        row.id === podium[0].id ? "border-vital/60" : ""
                      }`}
                    >
                      {row.id === podium[0].id && (
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-vital/70 via-white/20 to-transparent" />
                      )}
                      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-white/45">
                        {row.id === podium[0].id ? (
                          <Trophy size={12} className="text-vital-bright" />
                        ) : (
                          <Medal size={12} />
                        )}
                        Rank {podium.indexOf(row) + 1}
                      </p>
                      <BoardName row={row} big />
                      <p className="stat-figure tnum mt-3 break-words text-2xl font-black text-white md:text-3xl">
                        {formatFinish(row.finish_seconds)}
                      </p>
                      <RaceShort row={row} />
                    </li>
                  ))}
                </ul>
              )}

              {/* 第 4 名起：清單行（行高 ≥44px） */}
              {rest.length > 0 && (
                <ol className="mt-4 divide-y divide-[var(--line-fine)] border-t border-[var(--line-fine)]">
                  {rest.map((row) => (
                    <li
                      key={row.id}
                      className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 py-3"
                    >
                      <span className="rank-figure tnum w-8 flex-none text-right text-sm font-bold text-white/35">
                        {board.indexOf(row) + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <BoardName row={row} />
                      </div>
                      <span className="stat-figure tnum flex-none text-sm font-bold text-white">
                        {formatFinish(row.finish_seconds)}
                      </span>
                      <RaceShort row={row} />
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </section>

        {/* ===== 右 1/3：粘性卡（我的提交＋提交 CTA）；390 時順序堆疊 ===== */}
        <aside className="min-w-0 lg:sticky lg:top-24 lg:col-span-1 lg:self-start">
          {profile ? (
            <div className="card-dark p-6">
              {/* §5-7 凍結文案 */}
              <h2 className="text-lg font-black tracking-tight">我的完賽提交</h2>
              <div className="mt-4">
                <MyHyroxResults rows={mine} />
              </div>
              <a
                href="#submit"
                className="btn-base btn-vital btn-slab mt-6 min-h-11 w-full"
              >
                <Clock3 size={16} /> 提交我的完賽成績 <ArrowRight size={15} />
              </a>
            </div>
          ) : (
            <div className="card-dark p-6">
              <h2 className="text-lg font-black tracking-tight">提交完賽成績</h2>
              <p className="mt-2 break-words text-sm leading-relaxed text-white/65">
                會員提交完賽截圖與成績，經後台確認後就會上榜。
              </p>
              <Link
                href="/login?next=/hyrox/results"
                className="btn-base btn-vital btn-slab mt-5 min-h-11 w-full"
              >
                <LogIn size={16} /> 登入後提交
              </Link>
            </div>
          )}
        </aside>
      </div>

      {/* ===== 提交表提交表單（頁尾全寬；已登入才渲染） ===== */}
      {profile && (
        <section id="submit" className="pub-pad container-msw scroll-mt-24">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--line-hairline-strong)] pb-4">
            <h2 className="text-2xl font-black tracking-tight md:text-3xl">
              提交完賽成績
            </h2>
            <p className="text-xs text-white/50">
              上傳完賽證明截圖，經後台核對後上榜
            </p>
          </div>
          <div className="mt-6 max-w-2xl">
            <ResultSubmitForm divisions={divisions} />
          </div>
        </section>
      )}
    </div>
  );
}

/** 榜一列的「姓名／隊伍」顯示（Q-2 拍板：隊名主文字、隊友名第二行小字） */
function BoardName({
  row,
  big = false,
}: {
  row: {
    display_name: string | null;
    team_name: string | null;
    team_size: number;
    teammates: string[];
  };
  big?: boolean;
}) {
  if (row.team_size > 1 && row.team_name) {
    return (
      <div className="min-w-0">
        <p
          className={`min-w-0 break-words font-bold text-white ${big ? "mt-4 text-lg" : "text-sm"}`}
        >
          {row.team_name}
        </p>
        {row.teammates.length > 0 && (
          <p className="mt-0.5 min-w-0 break-words text-xs text-white/55">
            {row.teammates.join("・")}
          </p>
        )}
      </div>
    );
  }
  return (
    <p
      className={`min-w-0 break-words font-bold text-white ${big ? "mt-4 text-lg" : "text-sm"}`}
    >
      {row.display_name ?? "會員"}
    </p>
  );
}

/** 每列右側小字：賽事名稱（過長 truncate＋title）＋ 日期 MM/DD（§1.6） */
function RaceShort({ row }: { row: { race_name: string; race_date: string } }) {
  const md = row.race_date.slice(5).replace("-", "/");
  return (
    <span
      className="min-w-0 max-w-[11rem] flex-none truncate text-xs text-white/45"
      title={`${row.race_name} · ${row.race_date}`}
    >
      {row.race_name} · {md}
    </span>
  );
}
