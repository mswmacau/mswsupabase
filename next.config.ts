import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // H1：禁止 Server Actions。WAF 會攔截帶 next-action header 的 POST，
  // 所有寫入一律 Route Handler + 前端 fetch。
  // （原本這裡的 experimental.serverActions.bodySizeLimit 已刪除，
  //   圖片改由瀏覽器直傳 Supabase Storage，不再經過 Vercel Function。）
  images: {
    remotePatterns: [
      // Supabase Storage 產生的圖片網址
      { protocol: "https", hostname: "**.supabase.co" },
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
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
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
    ];

    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
