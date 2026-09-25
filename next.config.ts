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
};

export default nextConfig;
