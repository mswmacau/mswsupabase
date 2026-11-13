import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // H1：禁止 Server Actions。WAF 會攔截帶 next-action header 的 POST，
  // 所有寫入一律 Route Handler + 前端 fetch。
  // （原本這裡的 experimental.serverActions.bodySizeLimit 已刪除，
  //   圖片改由瀏覽器直傳 Supabase Storage，不再經過 Vercel Function。）
  images: {
    remotePatterns: [
      // Supabase Storage 產生的圖片網址
      //
      // 【安全修復 2026-11-13】原本是 hostname: "**.supabase.co"，
      // 等於放行「全世界任何人的 Supabase 專案」——任何人免費開一個專案、
      // 上傳 .svg，就能透過 /_next/image 讓本站的圖片優化器去抓他的內容
      // （SSRF 放大面 + 內容來源不可控）。實測攻擊路徑：
      //   /_next/image?url=https://audit-test-xyz123.supabase.co/x.svg
      //   修復前回 502/DNS_NOT_FOUND（代表「已放行，只是對方域名不存在」），
      //   修復後必須回 400（被白名單擋下）。
      //
      // 因此改為「只放行本專案」：hostname 精確匹配，不用任何萬用字元。
      // pathname 一併限制在公開物件路徑，避免順便放行簽名 URL / 其他 API。
      //   · site-assets      → 公開讀取，路徑 /storage/v1/object/public/site-assets/**
      //   · run-screenshots  → 私有桶，前端一律用 signed URL 且走 <img>
      //                        （不經 next/image），故不需在此放行。
      // ⚠️ 若日後更換 Supabase 專案（ref 改變），此處必須同步更新，
      //    否則遠端圖會 400。這是有意的取捨：精確白名單優先於方便。
      {
        protocol: "https",
        hostname: "yaacbsdltqfdzwmawzes.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },

  // 去掉 X-Powered-By: Next.js（減少指紋洩漏）
  poweredByHeader: false,

  // 安全標頭（2026-09-25 真機審計修復）
  // 注意：script-src / style-src 必須保留 'unsafe-inline'——
  // Next.js App Router 會在 HTML 內嵌 flight data <script>，
  // 而 Tailwind 與 <html style={cssVars}> 依賴內聯樣式；收緊會直接整爛個站。
  // 重點收緊的是 connect-src / img-src / object-src / frame-ancestors。
  async headers() {
    // 【2026-11-13 補】React 開發模式（dev）會用 eval() 做 hot reload / stack 還原，
    // 在沒有 'unsafe-eval' 的 CSP 下，每個頁面都會噴一則 console error：
    //   "eval() is not supported in this environment..."
    // 這是既有缺陷（與本次升級無關），但會令 dev 的 console 一直有紅字，
    // 蓋掉真正要看的錯誤。因此只在「非 production」時附加 'unsafe-eval'。
    // ⚠️ production 的 CSP 與原本逐字相同，沒有放寬任何東西。
    const isDev = process.env.NODE_ENV !== "production";
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      // data:/blob: 供截圖預覽（URL.createObjectURL）與內聯圖示；
      // *.supabase.co 供 Supabase Storage 公開圖
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self' data:",
      // Supabase REST / Auth / Realtime；瀏覽器直傳 Storage 也走這裡
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");

    const securityHeaders = [
      { key: "Content-Security-Policy", value: csp },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
      // HSTS：強制瀏覽器後續一律走 HTTPS（max-age=63072000 = 2 年）。
      // 刻意【不加 preload】：
      //   1. 撤銷週期不對等——一旦進了瀏覽器內建的 HSTS preload list，
      //      移除申請到各瀏覽器版本生效是以「月」計，期間無法降級，
      //      但加上的成本只有一次部署，風險與收益不成比例。
      //   2. includeSubDomains 會連帶把舊子域一併鎖死，本站仍有部分
      //      歷史子域未完成 HTTPS 整備，貿然 preload 可能直接讓它們連不上。
      //   先用 max-age 讓真實流量自行記住，觀察穩定後再另行評估 preload。
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains",
      },
    ];

    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
