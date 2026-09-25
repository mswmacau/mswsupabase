/** Hero 背景視覺：單杠剪影 + 光暈，純 SVG，不依賴外部圖片 */
export function HeroVisual() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 600 420"
      className="h-full w-full"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0047AB" stopOpacity="0" />
          <stop offset="45%" stopColor="#0057FF" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#E3001B" stopOpacity="0.9" />
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="40%" r="50%">
          <stop offset="0%" stopColor="#0057FF" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0057FF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="figGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.25" />
        </linearGradient>
      </defs>

      {/* 光暈 */}
      <ellipse cx="300" cy="150" rx="260" ry="190" fill="url(#glow)" />

      {/* 單杠立柱 */}
      <path d="M120 60 V330" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="6" strokeLinecap="round" />
      <path d="M480 60 V330" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="6" strokeLinecap="round" />
      <path d="M120 330 H480" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="4" strokeLinecap="round" />

      {/* 横杠 */}
      <path d="M100 110 H500" stroke="url(#barGrad)" strokeWidth="10" strokeLinecap="round" />

      {/* 懸垂人形：頭、手臂、身軀、腿 */}
      <circle cx="300" cy="152" r="17" fill="url(#figGrad)" />
      <path d="M300 169 V258" stroke="url(#figGrad)" strokeWidth="13" strokeLinecap="round" />
      <path d="M300 178 L262 130" stroke="url(#figGrad)" strokeWidth="10" strokeLinecap="round" />
      <path d="M300 178 L338 130" stroke="url(#figGrad)" strokeWidth="10" strokeLinecap="round" />
      <path d="M300 258 L268 344" stroke="url(#figGrad)" strokeWidth="11" strokeLinecap="round" />
      <path d="M300 258 L332 344" stroke="url(#figGrad)" strokeWidth="11" strokeLinecap="round" />

      {/* 動態弧線 */}
      <path
        d="M150 380 Q300 400 450 372"
        stroke="#E3001B"
        strokeOpacity="0.55"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M180 396 Q300 412 420 390"
        stroke="#0057FF"
        strokeOpacity="0.4"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
