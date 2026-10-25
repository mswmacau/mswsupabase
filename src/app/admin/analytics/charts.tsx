/**
 * src/app/admin/analytics/charts.tsx — 純 SVG / CSS 圖表元件（T-24）
 *
 * Owner：方砚。計劃 §4.3 拍板：不裝任何圖表庫，全部手寫 SVG / CSS。
 * 全部為無狀態展示元件（無 hooks、無事件），可在 Server Component 直接用。
 *
 * 紀律：
 *  - 數字與明細表同源（同一次取數的同一份資料），不各自重算；
 *  - 顏色走 theme 的 CSS 變數（--color-cobalt／--color-vital 等），
 *    跟隨後台「網站設定」換色；
 *  - 空數據由呼叫端處理（本元件只保證 data.length > 0 時的渲染）。
 */

/* =============================================================
 * 格式化（顯示用；不改變資料本身）
 * ============================================================= */

/** 0–1 → 「21%」 */
export function fmtPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** 毫秒 → 「14 秒」／「1 分 30 秒」 */
export function fmtDwell(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} 秒`;
  const min = Math.floor(totalSec / 60);
  const restSec = totalSec % 60;
  return restSec === 0 ? `${min} 分鐘` : `${min} 分 ${restSec} 秒`;
}

/** 'YYYY-MM' → '10月'；一月附年份（'26年1月'）避免跨年看錯 */
export function monthShort(month: string): string {
  const mm = Number(month.slice(5, 7));
  return month.endsWith("-01") ? `${month.slice(2, 4)}年1月` : `${mm}月`;
}

/* =============================================================
 * 柱狀圖（會員增長）
 * ============================================================= */

export interface ColumnDatum {
  label: string;
  value: number;
}

export function ColumnChart({
  data,
  ariaLabel,
  color = "var(--color-cobalt)",
}: {
  data: ColumnDatum[];
  ariaLabel: string;
  color?: string;
}) {
  const W = 640;
  const H = 210;
  const padL = 10;
  const padR = 10;
  const padT = 22;
  const padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = innerW / data.length;
  const barW = Math.min(30, slot * 0.62);
  const baseY = padT + innerH;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={ariaLabel}
      className="h-auto overflow-visible"
    >
      {/* 頂格參考線（= 最大值） */}
      <line
        x1={padL}
        x2={W - padR}
        y1={padT}
        y2={padT}
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={1}
      />
      <text x={padL} y={padT - 7} fontSize={10} fill="rgba(255,255,255,0.5)">
        最高 {max}
      </text>
      {/* 基線 */}
      <line
        x1={padL}
        x2={W - padR}
        y1={baseY}
        y2={baseY}
        stroke="rgba(255,255,255,0.2)"
        strokeWidth={1}
      />
      {data.map((d, i) => {
        const h = max > 0 ? (d.value / max) * innerH : 0;
        const x = padL + slot * i + (slot - barW) / 2;
        const y = baseY - h;
        return (
          <g key={`${d.label}-${i}`}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, d.value > 0 ? 2 : 0)}
              rx={3}
              fill={color}
              opacity={d.value > 0 ? 0.9 : 0.25}
            />
            {d.value > 0 && (
              <text
                x={x + barW / 2}
                y={y - 5}
                fontSize={10}
                textAnchor="middle"
                fill="rgba(255,255,255,0.75)"
              >
                {d.value}
              </text>
            )}
            <text
              x={x + barW / 2}
              y={baseY + 15}
              fontSize={10.5}
              textAnchor="middle"
              fill="rgba(255,255,255,0.55)"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* =============================================================
 * 折線圖（月度達標率 / 每月跑步公里）
 * ============================================================= */

export interface LineDatum {
  label: string;
  value: number;
}

export function LineChart({
  data,
  ariaLabel,
  yMax,
  color = "var(--color-vital)",
  formatValue,
}: {
  data: LineDatum[];
  ariaLabel: string;
  /** 自訂縱軸上限（達標率傳 1；公里傳 rounded max） */
  yMax?: number;
  color?: string;
  formatValue: (v: number) => string;
}) {
  const W = 640;
  const H = 210;
  const padL = 10;
  const padR = 14;
  const padT = 22;
  const padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const max =
    yMax ?? (Math.max(...data.map((d) => d.value), 0) > 0
      ? Math.max(...data.map((d) => d.value))
      : 1);
  const safeMax = max > 0 ? max : 1;
  const slot = innerW / Math.max(data.length, 1);
  const baseY = padT + innerH;

  const points = data.map((d, i) => ({
    x: padL + slot * (i + 0.5),
    y: baseY - (d.value / safeMax) * innerH,
    d,
  }));

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={ariaLabel}
      className="h-auto overflow-visible"
    >
      {/* 三格參考線：0 / 中 / 頂 */}
      {[0, 0.5, 1].map((f) => {
        const y = baseY - f * innerH;
        return (
          <g key={f}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.1)"
              strokeWidth={1}
            />
            <text x={W - padR + 2} y={y + 3} fontSize={9} fill="rgba(255,255,255,0.45)">
              {formatValue(safeMax * f)}
            </text>
          </g>
        );
      })}
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <g key={`${p.d.label}-${i}`}>
          <circle cx={p.x} cy={p.y} r={3.5} fill={color} />
          <text
            x={p.x}
            y={p.y - 8}
            fontSize={10}
            textAnchor="middle"
            fill="rgba(255,255,255,0.8)"
          >
            {formatValue(p.d.value)}
          </text>
          <text
            x={p.x}
            y={baseY + 15}
            fontSize={10.5}
            textAnchor="middle"
            fill="rgba(255,255,255,0.55)"
          >
            {p.d.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* =============================================================
 * 橫向條形（CSS 實作；行為畫像 / TOP5 場次 / 每月發券）
 * ============================================================= */

export interface BarRow {
  label: string;
  value: number;
  /** 條形右方的補充數字（如「出席 12」） */
  note?: string;
}

export function BarRows({
  rows,
  ariaLabel,
  color = "var(--color-cobalt)",
  maxOverride,
}: {
  rows: BarRow[];
  ariaLabel: string;
  color?: string;
  /** 自訂比較基準（如三型人數互比、而非各自佔總數） */
  maxOverride?: number;
}) {
  const max = Math.max(maxOverride ?? 0, ...rows.map((r) => r.value), 1);

  return (
    <ul className="space-y-2.5" aria-label={ariaLabel}>
      {rows.map((r) => {
        const pct = (r.value / max) * 100;
        return (
          <li key={r.label} className="flex items-center gap-3">
            <span
              className="w-28 shrink-0 truncate text-xs text-white/70"
              title={r.label}
            >
              {r.label}
            </span>
            <span className="h-4 min-w-0 flex-1 rounded-full bg-white/5">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(pct, r.value > 0 ? 2 : 0)}%`,
                  backgroundColor: color,
                }}
              />
            </span>
            <span className="stat-figure w-12 shrink-0 text-right text-sm font-bold">
              {r.value}
            </span>
            {r.note && (
              <span className="w-24 shrink-0 text-xs text-white/55">{r.note}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* =============================================================
 * 小元件：區塊說明（「呢個數字咩意思」）
 * ============================================================= */

export function ChartNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-white/60">
      <span aria-hidden className="mt-px shrink-0 font-bold text-cobalt-bright">
        呢個數字咩意思
      </span>
      <span>{children}</span>
    </p>
  );
}

/** 區塊級空狀態（與 admin 現有虛線框空狀態同款） */
export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-white/15 px-4 py-10 text-center text-sm text-white/70">
      {children}
    </div>
  );
}

/** 區塊級取數失敗（與空數據區分：這是有數據但讀不到） */
export function FailedNote() {
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-6 text-center text-sm text-amber-200">
      呢個數字暫時讀不到，請稍後重試或聯絡技術人員。
    </div>
  );
}
