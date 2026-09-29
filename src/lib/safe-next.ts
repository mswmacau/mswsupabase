/**
 * src/lib/safe-next.ts — 安全的站內導向路徑（防開放重定向）
 *
 * 純模組：不 import next/server，Route Handler 與 Client Component 皆可安全引入。
 *
 * 【為何獨立成檔，不放進 src/lib/api.ts】
 * src/lib/api.ts 頂部有 `import { NextResponse } from "next/server";`，屬 server-only 模組
 * （該檔註解亦明寫「前端不直接 import 本檔」）。若 safeNext 放在 api.ts，Client Component
 * 一旦引用就會把 next/server 拖進 client bundle，甚至直接報錯。而本函數前後端都要用
 * （Route Handler 決定 Location／next，前端 LoginForm 亦需同一套白名單），
 * 故必須是零依賴、無 next/* import 的純模組，獨立成檔。
 *
 * 只接受單一斜線開頭的站內相對路徑，擋掉：
 *   //evil.com（協議相對）、/\evil.com（反斜線變體）、/api/*、控制字元（回應標頭注入）
 */
export function safeNext(raw: unknown, fallback: string): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return fallback;
  if (!v.startsWith("/")) return fallback;
  if (v.startsWith("//") || v.startsWith("/\\")) return fallback;
  if (v.startsWith("/api/")) return fallback;
  if (/[\u0000-\u001F\u007F]/.test(v)) return fallback; // C0 控制字元 + DEL（防回應標頭注入）
  return v;
}
