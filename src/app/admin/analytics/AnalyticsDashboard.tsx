/**
 * src/app/admin/analytics/AnalyticsDashboard.tsx — 數據分析儀表板 UI（T-24）
 *
 * Owner：方砚。架構對齊計劃 V2 §5.6（資訊架構）與 §8.3（RPC 回傳結構）。
 *
 * 設計紀律：
 *  - 一次取數、同一份資料渲染全部圖表與明細表（數字必然對得上）；
 *  - 圖表純 SVG / CSS 手寫（計劃 §4.3 紅線：不裝任何圖表庫）；
 *  - 每個圖表旁一句「呢個數字咩意思」人話解釋；頂部有指標說明摺疊區；
 *  - 空數據（如追蹤剛上線）與取數失敗分別顯示，不空白、不報錯；
 *  - 技術詞（RPC 名等）不出現在 UI；文案用粵式書面口語。
 *
 * 本檔為 Server Component（無 "use client"）：圖表靜態渲染即可，
 * 唯一需要客戶端的重試按鈕拆去 RetryButton.tsx。
 */

import Link from "next/link";
import { currentMonth, formatKm, monthLabel } from "@/lib/utils";
import {
  BarRows,
  ChartNote,
  ColumnChart,
  EmptyNote,
  FailedNote,
  LineChart,
  fmtDwell,
  fmtPct,
  monthShort,
} from "./charts";
import { RetryButton } from "./RetryButton";
import type {
  ActivityOverviewData,
  AnalyticsPayload,
  BehaviorSegmentsData,
  CouponSummaryData,
  EventRegistrationsData,
  MemberGrowthData,
  PageStatsData,
  RunMonthlyData,
  SessionAttendanceData,
} from "./types";

/* =============================================================
 * 共用小元件
 * ============================================================= */

function StatCard({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="text-xs text-white/60">{label}</div>
      <div className="stat-figure mt-1 text-2xl font-black">
        {value}
        {unit && <span className="ml-1 text-sm font-bold text-white/70">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-xs text-white/55">{sub}</div>}
    </div>
  );
}

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card-dark p-6 md:p-8">
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-white/70">{desc}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-3 text-sm font-bold text-white/85">{children}</h4>
  );
}

/* =============================================================
 * 指標說明（頂部摺疊區：每個指標一句白話定義）
 * ============================================================= */

const METRIC_DEFS: { term: string; def: string }[] = [
  {
    term: "總會員",
    def: "到而家為止註冊咗嘅會員總數（與後台總覽同一個數字）。",
  },
  {
    term: "30 天活躍",
    def: "最近 30 日內有已確認訓練簽到、或有已確認跑步紀錄的會員人數。",
  },
  {
    term: "本月確認公里",
    def: "會員選定計入本月的跑步紀錄中，已確認部分的公里總數；進行中的月份未計完。",
  },
  {
    term: "待審核",
    def: "等緊管理員確認的跑步提交與訓練簽到筆數，確認後里程與積分先至入帳。",
  },
  {
    term: "券核銷率",
    def: "已使用的優惠券 ÷ 已發放總數（包含已過期的券）。",
  },
  {
    term: "會員增長",
    def: "每一個月裏面有幾多人新加入（近 12 個月，含進行中的本月）。",
  },
  {
    term: "會員活躍度",
    def: "30 / 90 天內有動作的會員有幾多；連續 90 日無簽到、無跑步紀錄叫「沉默」。",
  },
  {
    term: "行為畫像",
    def: "會員按積分、總里程的分佈，以及近 90 天的訓練型（同一人可以同時屬兩型）。",
  },
  {
    term: "月度達標率",
    def: "當月有已確認紀錄的人之中，有幾多人跑滿每月目標公里（預設 300 公里）。",
  },
  {
    term: "訓練場次出席",
    def: "每一場的報名人數、出席人數與出席率；出席率以報名人數（非名額）為分母。",
  },
  {
    term: "跑步挑戰",
    def: "每月已確認總公里、提交數（含待審與已駁回）、待審數、人均公里與達標人數。",
  },
  {
    term: "頁面流量",
    def: "邊個頁面最多人看、估算到訪與平均停留；屬估算值，只供參考。",
  },
  {
    term: "活動報名",
    def: "會員在站內報名活動的人數（最多 20 場，依人數排序）；走外部連結報名的不在內。",
  },
];

/* =============================================================
 * 頂部數字卡列
 * ============================================================= */

function NumberCards({ data }: { data: AnalyticsPayload }) {
  const growth = data.memberGrowth;
  const activity = data.activity;
  const run = data.runMonthly;
  const coupon = data.coupon;

  const thisMonthRun = run?.months.find((m) => m.month === currentMonth()) ?? null;
  const pendingTotal = data.pending ? data.pending.runs + data.pending.checkins : null;

  const cards: { label: string; value: string; unit?: string; sub?: string }[] = [
    {
      label: "總會員",
      value: growth ? String(growth.total_members) : "—",
      sub: "累計註冊會員",
    },
    {
      label: "30 天活躍",
      value: activity ? String(activity.active_30d) : "—",
      sub: activity ? `佔全體 ${fmtPct(activity.active_rate_30d)}` : undefined,
    },
    {
      label: "本月確認公里",
      value: thisMonthRun ? formatKm(thisMonthRun.total_km) : run ? "0" : "—",
      unit: "km",
      sub: "已確認跑步里程（本月未計完）",
    },
    {
      label: "待審核",
      value: pendingTotal === null ? "—" : String(pendingTotal),
      sub: "跑步提交 + 訓練簽到",
    },
    {
      label: "券核銷率",
      value: coupon ? fmtPct(coupon.redeemed_rate) : "—",
      sub: coupon ? `已發放 ${coupon.total} 張` : undefined,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="card-dark p-5">
          <div className="text-xs uppercase tracking-[0.16em] text-white/60">
            {c.label}
          </div>
          <div className="stat-figure mt-2 text-3xl font-black">
            {c.value}
            {c.unit && (
              <span className="ml-1 text-base font-bold text-white/70">{c.unit}</span>
            )}
          </div>
          {c.sub && <div className="mt-1 text-xs text-white/55">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/* =============================================================
 * 一、會員增長（柱狀，近 12 月）
 * ============================================================= */

function MemberGrowthSection({ data }: { data: MemberGrowthData | null }) {
  if (!data) {
    return (
      <Section title="會員增長（近 12 個月）" desc="每月有幾多人加入。">
        <FailedNote />
      </Section>
    );
  }

  const months = data.months;
  const first = months[0];
  const last = months[months.length - 1];

  return (
    <Section
      title="會員增長（近 12 個月）"
      desc="每一個月新加入的會員人數，連同累計會員數一睇就知個社群係脹定縮。"
    >
      {months.length === 0 ? (
        <EmptyNote>尚未有會員註冊記錄。</EmptyNote>
      ) : (
        <>
          <ColumnChart
            data={months.map((m) => ({
              label: monthShort(m.month),
              value: m.new_members,
            }))}
            ariaLabel={`近 12 個月每月新加入會員人數，${monthLabel(first.month)} ${first.new_members} 人，${monthLabel(last.month)} ${last.new_members} 人`}
          />
          <p className="mt-3 text-sm text-white/70">
            累計會員由 {monthLabel(first.month)}的 {first.cumulative_members} 人，增至{" "}
            {monthLabel(last.month)}的 {last.cumulative_members} 人。
          </p>
          <ChartNote>
            每支柱係嗰個月新加入嘅會員人數（包含進行中嘅本月，數字未計完）；
            累計數係計到嗰個月尾為止嘅總會員。
          </ChartNote>
        </>
      )}
    </Section>
  );
}

/* =============================================================
 * 二、會員活躍度（數字 + 條形）
 * ============================================================= */

function ActivitySection({ data }: { data: ActivityOverviewData | null }) {
  if (!data) {
    return (
      <Section title="會員活躍度" desc="30 / 90 天內有動作的會員有幾多。">
        <FailedNote />
      </Section>
    );
  }

  return (
    <Section
      title="會員活躍度"
      desc="會員係唔係真係練開？睇活躍人數同沉默人數就知。"
    >
      {data.total_members === 0 ? (
        <EmptyNote>尚未有會員資料。</EmptyNote>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="30 天活躍"
              value={String(data.active_30d)}
              sub={`佔全體 ${fmtPct(data.active_rate_30d)}`}
            />
            <StatCard
              label="90 天活躍"
              value={String(data.active_90d)}
              sub={`佔全體 ${fmtPct(data.active_rate_90d)}`}
            />
            <StatCard
              label="90 天無動作"
              value={String(data.silent_90d)}
              sub="連續 90 日無簽到、無跑步紀錄"
            />
          </div>
          <div className="mt-5">
            <BarRows
              rows={[
                {
                  label: "30 天內有動作",
                  value: data.active_30d,
                  note: fmtPct(data.active_rate_30d),
                },
                {
                  label: "90 天內有動作",
                  value: data.active_90d,
                  note: fmtPct(data.active_rate_90d),
                },
              ]}
              maxOverride={data.total_members}
              ariaLabel="活躍會員條形圖，以全體會員為全長"
            />
            <p className="mt-2 text-xs text-white/50">
              每條嘅全長 = 全體 {data.total_members} 位會員。
            </p>
          </div>
          <ChartNote>
            「有動作」= 期限內有已確認嘅訓練簽到或已確認嘅跑步紀錄；
            條形右邊嗰個百分比，係以全體會員為分母計出嚟。
          </ChartNote>
        </>
      )}
    </Section>
  );
}

/* =============================================================
 * 三、行為畫像（橫向條形 ×3）
 * ============================================================= */

function BehaviorSection({ data }: { data: BehaviorSegmentsData | null }) {
  if (!data) {
    return (
      <Section title="行為畫像" desc="會員按積分、里程與訓練型分佈。">
        <FailedNote />
      </Section>
    );
  }

  const total = Math.max(
    1,
    ...data.points_segments.map((s) => s.count),
    ...data.km_segments.map((s) => s.count)
  );
  const allZero =
    data.points_segments.every((s) => s.count === 0) &&
    data.km_segments.every((s) => s.count === 0) &&
    data.checkin_type_90d === 0 &&
    data.run_type_90d === 0 &&
    data.both_type_90d === 0;

  return (
    <Section
      title="行為畫像"
      desc="我哋會員係咩類型的人？積分、里程同訓練型三個角度睇。"
    >
      {allZero ? (
        <EmptyNote>尚未有會員數據，暫未能計算分佈。</EmptyNote>
      ) : (
        <div className="space-y-7">
          <div>
            <SubHead>積分分佈</SubHead>
            <BarRows
              rows={data.points_segments.map((s) => ({
                label: s.label,
                value: s.count,
              }))}
              maxOverride={total}
              color="var(--color-vital)"
              ariaLabel="會員積分分段人數分佈"
            />
          </div>
          <div>
            <SubHead>總里程分佈</SubHead>
            <BarRows
              rows={data.km_segments.map((s) => ({
                label: s.label,
                value: s.count,
              }))}
              maxOverride={total}
              ariaLabel="會員總里程分段人數分佈"
            />
          </div>
          <div>
            <SubHead>近 90 天訓練型</SubHead>
            <BarRows
              rows={[
                { label: "簽到型", value: data.checkin_type_90d },
                { label: "跑步型", value: data.run_type_90d },
                { label: "兩者都拍", value: data.both_type_90d },
              ]}
              color="var(--color-vital)"
              ariaLabel="近 90 天訓練型人數"
            />
          </div>
        </div>
      )}
      <ChartNote>
        積分同里程每條嘅全長 = 人數最多嗰段；訓練型三條互相比。
        同一人可以同時屬「簽到型」同「跑步型」，所以三條加埋可能多過總人數。
      </ChartNote>
    </Section>
  );
}

/* =============================================================
 * 四、月度達標率（折線）
 * ============================================================= */

function GoalRateSection({ data }: { data: BehaviorSegmentsData | null }) {
  const rows = data?.monthly_goal_rate ?? null;

  if (!rows) {
    return (
      <Section title="月度達標率" desc="每月有幾多人跑滿目標公里。">
        <FailedNote />
      </Section>
    );
  }

  return (
    <Section
      title="月度達標率（近 6 個月）"
      desc="跑步挑戰搞成唔成功？睇每月達標率嘅走勢。"
    >
      {rows.length === 0 ? (
        <EmptyNote>尚無跑步紀錄，暫未能計算達標率。</EmptyNote>
      ) : (
        <>
          <LineChart
            data={rows.map((r) => ({ label: monthShort(r.month), value: r.rate }))}
            yMax={1}
            formatValue={fmtPct}
            ariaLabel={`近 6 個月每月達標率，${rows
              .map((r) => `${monthShort(r.month)} ${fmtPct(r.rate)}`)
              .join("、")}`}
          />
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/65">
            {rows.map((r) => (
              <span key={r.month}>
                {monthShort(r.month)}：{r.qualified} / {r.submitters} 人達標
              </span>
            ))}
          </div>
          <ChartNote>
            達標 = 當月已確認里程達到每月目標（預設 300 公里）；
            分母係當月有已確認紀錄嘅人數，所以係「有跑嘅人裏面有幾多人達標」。
          </ChartNote>
        </>
      )}
    </Section>
  );
}

/* =============================================================
 * 五、訓練場次出席（明細表 + TOP 5 條形）
 * ============================================================= */

function SessionAttendanceSection({
  data,
}: {
  data: SessionAttendanceData | null;
}) {
  if (!data) {
    return (
      <Section title="訓練場次出席" desc="邊場最多人報名、出席率有幾高。">
        <FailedNote />
      </Section>
    );
  }

  const sessions = data.sessions;
  const top5 = sessions.slice(0, 5);

  return (
    <Section
      title="訓練場次出席"
      desc="每一場有幾多人報名、有幾多人真係到，直接睇出席率。"
    >
      {sessions.length === 0 ? (
        <EmptyNote>尚無訓練場次資料。</EmptyNote>
      ) : (
        <div className="space-y-8">
          <div>
            <SubHead>最多人報名場次 TOP 5</SubHead>
            <BarRows
              rows={top5.map((s) => ({
                label: s.session_date,
                value: s.registered,
                note: `出席 ${s.attended}`,
              }))}
              ariaLabel="最多人報名場次前五名（按報名人數）"
            />
            <p className="mt-2 text-xs text-white/50">
              每條 = 報名人數（已排除已駁回）；右邊數字 = 實際出席人數。
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-ink-line">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">
                各訓練場次報名與出席明細（最多 20 場，依報名人數排序）
              </caption>
              <thead>
                <tr className="border-b border-ink-line text-left text-xs uppercase tracking-[0.14em] text-white/70">
                  <th className="py-3 pl-4 pr-4">日期</th>
                  <th className="py-3 pr-4">名稱</th>
                  <th className="py-3 pr-4 text-right">名額</th>
                  <th className="py-3 pr-4 text-right">報名</th>
                  <th className="py-3 pr-4 text-right">出席</th>
                  <th className="py-3 pr-4 text-right">出席率</th>
                  <th className="py-3 pr-4 text-right">名額用量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-line">
                {sessions.map((s) => (
                  <tr key={s.session_id}>
                    <td className="py-3 pl-4 pr-4 font-semibold whitespace-nowrap">
                      {s.session_date}
                    </td>
                    <td className="py-3 pr-4 text-white/75">{s.title}</td>
                    <td className="py-3 pr-4 text-right text-white/75">
                      {s.capacity}
                    </td>
                    <td className="py-3 pr-4 text-right font-semibold">
                      {s.registered}
                    </td>
                    <td className="py-3 pr-4 text-right text-white/75">
                      {s.attended}
                    </td>
                    <td className="py-3 pr-4 text-right text-white/75">
                      {fmtPct(s.attendance_rate)}
                    </td>
                    <td className="py-3 pr-4 text-right text-white/75">
                      {fmtPct(s.capacity_usage)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <ChartNote>
        報名 = 未被駁回嘅報名記錄（包含待確認）；出席 = 已確認簽到。
        出席率用報名人數做分母，所以人少但準時到場嘅場次都會有高出席率。
      </ChartNote>
    </Section>
  );
}

/* =============================================================
 * 六、跑步挑戰（折線 + 數字卡）
 * ============================================================= */

function RunMonthlySection({ data }: { data: RunMonthlyData | null }) {
  if (!data) {
    return (
      <Section title="跑步挑戰" desc="每月總公里、提交與待審數。">
        <FailedNote />
      </Section>
    );
  }

  const months = data.months;
  const thisMonth = months.find((m) => m.month === currentMonth()) ?? null;

  return (
    <Section
      title="跑步挑戰（近 12 個月）"
      desc="每月跑咗幾多公里、有幾多人參與、有幾多仲等緊確認。"
    >
      {months.length === 0 ? (
        <EmptyNote>尚無跑步紀錄。</EmptyNote>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              label="本月總公里"
              value={thisMonth ? formatKm(thisMonth.total_km) : "0"}
              unit="km"
              sub="已確認"
            />
            <StatCard
              label="本月提交"
              value={String(thisMonth?.submissions ?? 0)}
              sub="含待審與已駁回"
            />
            <StatCard
              label="本月待審"
              value={String(thisMonth?.pending ?? 0)}
              sub="等管理員確認"
            />
            <StatCard
              label="本月人均公里"
              value={String(thisMonth?.avg_km_per_member ?? 0)}
              sub="有確認紀錄嘅會員計"
            />
            <StatCard
              label="本月達標人數"
              value={String(thisMonth?.qualified ?? 0)}
              sub="達到每月目標"
            />
          </div>
          <div className="mt-6">
            <LineChart
              data={months.map((m) => ({
                label: monthShort(m.month),
                value: m.total_km,
              }))}
              formatValue={(v) => formatKm(v)}
              ariaLabel={`近 12 個月每月已確認總公里，${months
                .map((m) => `${monthShort(m.month)} ${formatKm(m.total_km)} 公里`)
                .join("、")}`}
            />
          </div>
          <ChartNote>
            每點係嗰個月已確認嘅總公里；提交數包含待審核同已駁回嘅紀錄，
            所以公里數通常會低過提交數。進行中嘅本月數字未計完。
          </ChartNote>
        </>
      )}
    </Section>
  );
}

/* =============================================================
 * 七、優惠券（數字卡 + 條形）
 * ============================================================= */

function CouponSection({ data }: { data: CouponSummaryData | null }) {
  if (!data) {
    return (
      <Section title="優惠券" desc="發咗幾多、用咗幾多。">
        <FailedNote />
      </Section>
    );
  }

  return (
    <Section
      title="優惠券"
      desc="達標獎勵發出去之後，會員到底有冇用？"
    >
      {data.total === 0 ? (
        <EmptyNote>尚未發放任何優惠券。</EmptyNote>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="可使用" value={String(data.by_status.active)} sub="未用、未過期" />
            <StatCard label="已使用" value={String(data.by_status.used)} sub="已核銷" />
            <StatCard label="已過期" value={String(data.by_status.expired)} sub="過期未用" />
            <StatCard
              label="核銷率"
              value={fmtPct(data.redeemed_rate)}
              sub={`已使用 ÷ 已發放 ${data.total} 張`}
            />
          </div>
          <div className="mt-6">
            <SubHead>近 12 個月發放數</SubHead>
            <BarRows
              rows={data.monthly.map((m) => ({
                label: monthShort(m.month),
                value: m.issued,
              }))}
              color="var(--color-vital)"
              ariaLabel="近 12 個月每月發放優惠券數量"
            />
          </div>
        </>
      )}
      <ChartNote>
        核銷率 = 已使用 ÷ 發放總數（包含已過期嗰批）；
        發放數按建立時間所屬月份計，含進行中嘅本月。
      </ChartNote>
    </Section>
  );
}

/* =============================================================
 * 八、活動報名（T-26；明細表，只數站內報名）
 * ============================================================= */

/** 非上架狀態的後綴標註（名單含草稿與已下架活動，避免誤讀） */
function eventStatusSuffix(status: string): string {
  if (status === "archived") return "（已下架）";
  if (status === "draft") return "（草稿）";
  return "";
}

function EventRegistrationsSection({ data }: { data: EventRegistrationsData | null }) {
  if (!data) {
    return (
      <Section title="活動報名（站內）" desc="邊場活動最多人喺站內報名。">
        <FailedNote />
      </Section>
    );
  }

  const rows = data.events;
  const total = rows.reduce((s, r) => s + Number(r.registered ?? 0), 0);

  return (
    <Section
      title="活動報名（站內）"
      desc="會員喺網站內報名活動的人數；最多人報名的活動排最前。"
    >
      {total === 0 ? (
        <EmptyNote>尚未有站內報名。</EmptyNote>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-line">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">
              各活動站內報名人數（最多 20 場，依報名人數排序）
            </caption>
            <thead>
              <tr className="border-b border-ink-line text-left text-xs uppercase tracking-[0.14em] text-white/70">
                <th className="py-3 pl-4 pr-4">活動</th>
                <th className="py-3 pr-4">日期</th>
                <th className="py-3 pr-4 text-right">站內報名</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-line">
              {rows.map((r) => (
                <tr key={r.event_id}>
                  <td className="py-3 pl-4 pr-4 font-semibold">
                    {r.title}
                    {eventStatusSuffix(r.status) && (
                      <span className="ml-1 text-xs font-normal text-white/50">
                        {eventStatusSuffix(r.status)}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 whitespace-nowrap text-white/75">
                    {r.event_date}
                  </td>
                  <td className="py-3 pr-4 text-right font-semibold">
                    {r.registered}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ChartNote>
        只算站內報名；走外部連結報名的不在內。會員取消報名會即時扣除，
        所以表中數字係「而家嘅報名人數」。最多列 20 場，未上架與已下架嘅
        活動都會列出來（旁邊有標註）。
      </ChartNote>
    </Section>
  );
}

/* =============================================================
 * 九、頁面流量（估算值；追蹤剛上線可能未有數據；T-25 加天數切換）
 * ============================================================= */

/** T-25：統計範圍選項（與 page.tsx 的 PAGE_STATS_DAY_OPTIONS 一致） */
const PAGE_STATS_DAY_OPTIONS = [7, 30, 90] as const;

/** T-25：天數切換（server 端以 ?days= 重新取數；連結式、當前範圍高亮） */
function DaysSwitcher({ days }: { days: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs text-white/55">統計範圍</span>
      <div role="group" aria-label="統計範圍" className="flex gap-2">
        {PAGE_STATS_DAY_OPTIONS.map((d) => {
          const active = d === days;
          return (
            <Link
              key={d}
              href={`?days=${d}`}
              aria-current={active ? "page" : undefined}
              className={`stat-figure inline-flex min-h-11 items-center px-4 text-sm transition ${
                active
                  ? "slab bg-vital text-white"
                  : "text-white/60 hover:text-white"
              }`}
            >
              近 {d} 天
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function PageStatsSection({ data }: { data: PageStatsData | null }) {
  if (!data) {
    return (
      <Section title="頁面流量（估算）" desc="邊個頁面最多人看。">
        <FailedNote />
      </Section>
    );
  }

  const empty = data.paths.length === 0 || data.total_views === 0;

  return (
    <Section
      title="頁面流量（估算）"
      desc="邊個頁面最多人睇、留低幾耐。追蹤數據有偏差，只供參考。"
    >
      <DaysSwitcher days={data.days} />
      {empty ? (
        <>
          <EmptyNote>
            追蹤剛上線，數據累積中。訪客瀏覽前台頁面並停留片刻後，這裏就會出現各頁面的瀏覽量與平均停留時間。
          </EmptyNote>
          <ChartNote>
            呢個數屬估算值：追蹤腳本被瀏覽器阻擋、連結預載或者會員重整頁面，
            都會令實際數字有偏差，所以只睇趨勢、唔好當真確數。
          </ChartNote>
        </>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-200">
              估算值
            </span>
            <span className="text-xs text-white/55">
              追蹤腳本被阻擋、連結預載或重整頁面都會造成偏差
            </span>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <StatCard
              label="總瀏覽量"
              value={String(data.total_views)}
              sub={`近 ${data.days} 天`}
            />
            <StatCard
              label="估算到訪"
              value={String(data.total_sessions)}
              sub="不重複追蹤識別碼"
            />
            <StatCard
              label="平均停留"
              value={fmtDwell(data.avg_dwell_ms)}
              sub="只計頁面喺眼前嘅時間"
            />
          </div>
          <div className="mt-6 overflow-x-auto rounded-xl border border-ink-line">
            <table className="w-full min-w-[560px] text-sm">
              <caption className="sr-only">
                各頁面瀏覽量、估算到訪與平均停留（依瀏覽量排序）
              </caption>
              <thead>
                <tr className="border-b border-ink-line text-left text-xs uppercase tracking-[0.14em] text-white/70">
                  <th className="py-3 pl-4 pr-4">頁面</th>
                  <th className="py-3 pr-4 text-right">瀏覽量</th>
                  <th className="py-3 pr-4 text-right">估算到訪</th>
                  <th className="py-3 pr-4 text-right">平均停留</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-line">
                {data.paths.map((p) => (
                  <tr key={p.path}>
                    <td className="py-3 pl-4 pr-4 font-semibold break-all">
                      {p.path}
                    </td>
                    <td className="py-3 pr-4 text-right font-semibold">{p.views}</td>
                    <td className="py-3 pr-4 text-right text-white/75">
                      {p.sessions}
                    </td>
                    <td className="py-3 pr-4 text-right text-white/75">
                      {fmtDwell(p.avg_dwell_ms)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ChartNote>
            估算到訪 = 不重複嘅追蹤識別碼數量（同一人到幾頁都算一次）；
            平均停留只計頁面喺眼前嘅時間，切走分頁、鎖屏唔計；
            各路徑加總會多過全站到訪數，因為同一人會睇幾頁。
          </ChartNote>
        </>
      )}
    </Section>
  );
}

/* =============================================================
 * 主元件
 * ============================================================= */

export function AnalyticsDashboard({ data }: { data: AnalyticsPayload }) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold">數據分析</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/75">
          所有數字只供管理員查看。除「頁面流量」標明估算值外，其餘數字均由系統記錄直接統計；
          進行中的月份，數字只計到目前為止。
        </p>
      </div>

      {data.allFailed && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-200"
        >
          <p>分析數據暫時讀不到，可能係網絡不穩，或者分析功能尚未啟用。</p>
          <div className="mt-3">
            <RetryButton />
          </div>
        </div>
      )}

      <details className="card-dark p-6">
        <summary className="cursor-pointer select-none text-sm font-bold text-white/85">
          指標說明（每個數字代表咩）
        </summary>
        <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {METRIC_DEFS.map((d) => (
            <div key={d.term}>
              <dt className="text-sm font-semibold text-white/85">{d.term}</dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-white/65">
                {d.def}
              </dd>
            </div>
          ))}
        </dl>
      </details>

      <NumberCards data={data} />

      <MemberGrowthSection data={data.memberGrowth} />
      <ActivitySection data={data.activity} />
      <BehaviorSection data={data.behavior} />
      <GoalRateSection data={data.behavior} />
      <SessionAttendanceSection data={data.sessionAttendance} />
      <RunMonthlySection data={data.runMonthly} />
      <CouponSection data={data.coupon} />
      <EventRegistrationsSection data={data.eventRegistrations} />
      <PageStatsSection data={data.pageStats} />
    </div>
  );
}
