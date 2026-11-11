import type { Metadata } from "next";
import { BRAND } from "@/lib/config";

/**
 * 私隱政策（/privacy）
 *
 * 三個現實用途，寫作時同時滿足：
 *  1. 交給 Google OAuth 同意畫面當「隱私政策連結」（需為實質內容，非模板）
 *  2. 網站即將收集「身份證後四位」（活動保險用），依澳門《個人資料保護法》第 8/2005 號法律告知
 *  3. 現有功能已在收集跑步截圖、轉帳截圖、積分紀錄、瀏覽統計
 *
 * 紀律：
 *  - 純靜態文案，不查 DB（避免 DB 未連線時頁面空白，亦讓搜尋引擎與 Google 審核抓取穩定）
 *  - 不寫程式碼無法證實的技術承諾（ISO 27001、AES-256 等一律不寫）
 *  - 聯絡電郵讀 BRAND.email（src/lib/config.ts:10），不在此硬編碼
 *  - 不新增 CSS，只用 globals.css 既有類（container-msw / section-pad / card-dark）
 */

export const metadata: Metadata = {
  title: "私隱政策",
  description:
    "MSW 街健館如何收集、使用及保存你的個人資料，包括活動保險登記所需的身份證後四位。",
};

/** 收集的資料分組（第 1 節） */
const DATA_GROUPS: { label: string; items: string }[] = [
  {
    label: "註冊帳戶時",
    items: "電郵地址、姓名、性別、電話、身份證後四位。",
  },
  {
    label: "活動報名時",
    items: "報名組別、每週運動次數、最長跑步距離。",
  },
  {
    label: "你上載的檔案",
    items: "跑步紀錄截圖、活動轉帳證明截圖。",
  },
  {
    label: "使用網站時產生的紀錄",
    items: "積分增減、優惠券兌換、瀏覽過的頁面統計、活動報名與簽到紀錄。",
  },
];

/** 逐項用途對應（第 2 節） */
const PURPOSES: { data: string; purpose: string }[] = [
  { data: "身份證後四位", purpose: "僅用於活動報名及保險登記，不作其他用途。" },
  { data: "電話", purpose: "活動改期、天氣取消等緊急通知。" },
  { data: "跑步紀錄截圖", purpose: "核實你提交的跑步紀錄。" },
  { data: "轉帳／付款截圖", purpose: "核實活動報名費用的收款。" },
  { data: "積分與兌換紀錄", purpose: "計算積分、發放與核銷優惠券。" },
  {
    data: "瀏覽頁面統計",
    purpose: "了解哪些頁面有人看、哪些沒人用，用來決定之後做甚麼內容。",
  },
  { data: "報名與簽到紀錄", purpose: "確認出席、計算參與場次。" },
];

/** 受託服務供應商（第 4 節） */
const PROCESSORS: { name: string; desc: string }[] = [
  { name: "Supabase", desc: "資料庫與檔案儲存，伺服器位於新加坡區域。" },
  { name: "Vercel", desc: "網站託管，負責把頁面送到你的瀏覽器。" },
  {
    name: "Google",
    desc: "只在你選擇以 Google 帳號登入時使用，提供你的姓名與電郵地址。",
  },
];

/** 保存期限（第 5 節） */
const RETENTION: { label: string; period: string }[] = [
  {
    label: "帳戶資料",
    period: "帳號存續期間保存；你要求刪除帳號時一併刪除。",
  },
  {
    label: "活動保險相關資料（包括身份證後四位）",
    period: "活動結束後 2 年刪除。",
  },
  {
    label: "跑步與轉帳截圖",
    period: "審核完成後保留作紀錄，供日後對帳查核。",
  },
];

/** 菱形標記列表（同 about 頁的視覺語言一致，不用圓點） */
function Points({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3">
      {items.map((text) => (
        <li key={text} className="flex gap-3">
          <span
            aria-hidden
            className="mt-[0.72em] block h-1.5 w-1.5 flex-none rotate-45 bg-vital-bright"
          />
          <span className="min-w-0 break-words">{text}</span>
        </li>
      ))}
    </ul>
  );
}

/** 章節外殼：細線分隔 + 左側黏貼式標題（lg 以上），不堆卡 */
function Chapter({
  no,
  title,
  children,
}: {
  no: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-[var(--line-fine-strong)] pt-10">
      <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-12">
        <h2 className="flex items-baseline gap-3 lg:sticky lg:top-24 lg:self-start">
          <span className="flex-none text-[11px] font-semibold uppercase tracking-[0.22em] text-vital-bright">
            {no}
          </span>
          <span className="min-w-0 text-xl font-bold leading-snug text-white">
            {title}
          </span>
        </h2>
        <div className="min-w-0 space-y-4 text-base leading-[1.9] text-[var(--text-muted)]">
          {children}
        </div>
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <>
      {/* ================= HERO ================= */}
      <section className="relative overflow-hidden border-b border-ink-line">
        <div
          className="pointer-events-none absolute -right-[16%] -top-[40%] h-[640px] w-[640px] rounded-full blur-[135px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--color-cobalt) 78%, transparent), transparent 66%)",
            opacity: 0.45,
          }}
        />
        <div className="clip-notch pointer-events-none absolute -bottom-14 -left-24 h-64 w-64 bg-vital/10" />

        <div className="grid-lines absolute inset-0" />
        <div className="noise-overlay" />

        <div className="container-msw relative z-10">
          <div className="relative pb-14 pt-28 md:pt-36 lg:pb-16">
            <div className="absolute left-0 top-40 hidden lg:block">
              <span className="vlabel text-white/50">{BRAND.nameEn}</span>
            </div>

            <div className="lg:pl-14">
              <h1 className="mt-6">
                <span className="display-xl block text-white">私隱政策</span>
                <span className="relative mt-1 block">
                  <span
                    aria-hidden
                    className="display-xl text-outline text-outline-vital absolute left-[0.04em] top-[0.04em] block"
                  >
                    Privacy
                  </span>
                  <span className="display-xl relative block text-vital-bright">
                    Privacy
                  </span>
                </span>
              </h1>

              <p className="mt-10 max-w-3xl text-base leading-relaxed text-white/70 sm:text-lg">
                這頁講清楚 MSW
                街健館（下稱「本會」）在營運網站與活動時收集哪些個人資料、每一項為甚麼要收、誰看得到，以及你可以怎樣處理自己的資料。我們盡量寫得具體，不用「改善服務」這類空話帶過。
              </p>

              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-white/45">
                最後更新：2026-11-12
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ================= 正文七節 ================= */}
      <div className="container-msw section-pad">
        <div className="space-y-12 lg:space-y-16">
          <Chapter no="01" title="我們收集哪些資料">
            <dl className="space-y-5">
              {DATA_GROUPS.map((group) => (
                <div key={group.label} className="min-w-0">
                  <dt className="text-sm font-bold text-white">{group.label}</dt>
                  <dd className="mt-1.5 min-w-0 break-words">{group.items}</dd>
                </div>
              ))}
            </dl>
            <p>
              你可以用電郵加密碼註冊，也可以用 Google
              帳號登入。用 Google
              登入時，我們只會收到 Google
              提供的姓名與電郵地址，不會取得你的 Google 密碼。
            </p>
          </Chapter>

          <Chapter no="02" title="為甚麼收集">
            <p>每一項資料都有對應的用途，沒有「先收起來備用」這種情況。</p>
            <ul className="divide-y divide-[var(--line-fine)] border-y border-[var(--line-fine)]">
              {PURPOSES.map((item) => (
                <li
                  key={item.data}
                  className="grid min-w-0 gap-1 py-4 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:gap-6"
                >
                  <span className="min-w-0 break-words text-sm font-semibold text-white">
                    {item.data}
                  </span>
                  <span className="min-w-0 break-words">{item.purpose}</span>
                </li>
              ))}
            </ul>
          </Chapter>

          <Chapter no="03" title="誰可以看到">
            <Points
              items={[
                "會員：登入後只看到自己的資料、積分與紀錄，看不到其他會員的。",
                "管理員：因營運需要（審核跑步紀錄、對帳、安排活動、處理保險登記）可以查看相關資料。",
                "第三方：我們不會出售你的個人資料，也不會提供給第三方作行銷用途。除了下一節列出的服務供應商，以及法律要求的情況，我們不會把資料交給其他人。",
              ]}
            />
          </Chapter>

          <Chapter no="04" title="存放位置與受託方">
            <p>資料主要存在以下服務，我們不自行架設伺服器。</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {PROCESSORS.map((p) => (
                <div key={p.name} className="card-dark min-w-0 p-5">
                  <div className="text-sm font-bold text-white">{p.name}</div>
                  <div className="mt-2 break-words text-sm leading-relaxed">
                    {p.desc}
                  </div>
                </div>
              ))}
            </div>
            <p>這些服務供應商只在提供服務所需的範圍內接觸資料。</p>
          </Chapter>

          <Chapter no="05" title="保存期限">
            <dl className="space-y-5">
              {RETENTION.map((item) => (
                <div key={item.label} className="min-w-0">
                  <dt className="text-sm font-bold text-white">{item.label}</dt>
                  <dd className="mt-1.5 min-w-0 break-words">{item.period}</dd>
                </div>
              ))}
            </dl>
          </Chapter>

          <Chapter no="06" title="你的權利">
            <p>
              你可以要求查閱、更正自己的個人資料，或要求刪除帳號。請電郵{" "}
              <a
                href={`mailto:${BRAND.email}`}
                className="break-all font-semibold text-vital-bright underline decoration-vital/40 underline-offset-4 transition hover:decoration-vital-bright"
              >
                {BRAND.email}
              </a>
              ，並在標題寫明「個人資料查閱」、「個人資料更正」或「刪除帳號」，我們會在合理時間內回覆。
            </p>
            <p>上述權利按澳門《個人資料保護法》（第 8/2005 號法律）規定。</p>
          </Chapter>

          <Chapter no="07" title="未滿 18 歲">
            <p>
              未滿 18
              歲使用本網站或報名活動，需先取得監護人同意。如果你是監護人而發現子女未經同意提供了資料，請電郵告訴我們，我們會處理。
            </p>
          </Chapter>

          {/* ===== 結尾：更新日期 + 管轄法律 ===== */}
          <section className="card-dark min-w-0 p-6 sm:p-8">
            <p className="text-sm font-semibold text-white">
              最後更新：2026-11-12
            </p>
            <p className="mt-2 break-words text-sm leading-relaxed text-[var(--text-muted)]">
              本政策受澳門特別行政區法律管轄。
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
