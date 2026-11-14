/**
 * 只抽「人看得見的文案」——排除 <script>/<style>/<noscript>。
 *
 * 為什麼要排除：Next.js App Router 會把 RSC flight data 與 bootstrap
 * 腳本內嵌成 <script> 的 textContent。那些內容每次建置都不同（chunk hash、
 * runtimeModuleIds…），如果一起抓進 textContent，diff 一定不是 0，
 * 但那是「建置產物」的差異，不是文案差異。
 *
 * 用法：AUDIT_BASE=http://127.0.0.1:3413 node _audit/home-hierarchy/dump-text.mjs before / 
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.AUDIT_BASE ?? "http://127.0.0.1:3412";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.resolve("_audit/home-hierarchy");
const LABEL = process.argv[2] ?? "dump";
const RAW = process.argv[3] ?? "/";
const ROUTE = RAW.startsWith("/") ? RAW : `/${RAW}`;

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(`${BASE}${ROUTE}`, { waitUntil: "networkidle", timeout: 60000 });

// 先把整頁捲過一次，確保 reveal / scrub / CountUp 都跑到終態
await page.evaluate(async () => {
  document.documentElement.style.scrollBehavior = "auto";
  const step = Math.round(innerHeight * 0.6);
  for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
    scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 70));
  }
  scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 900));
});

const text = await page.evaluate(() => {
  // 用 TreeWalker 走可見文字節點；<script>/<style>/<noscript> 直接跳過。
  // 注意：這裡「可見」不等於「沒被 display:none」——折疊中的區塊文字仍要收進來，
  // 所以不判斷 computed display，只排除非文案的技術性節點。
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let p = node.parentElement;
      while (p) {
        if (SKIP.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        p = p.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const parts = [];
  let n;
  while ((n = walker.nextNode())) parts.push(n.nodeValue ?? "");
  let t = parts.join("\n");
  // 倒數每秒變動 → 正規化成固定佔位（唯一允許的變動源，逐字說明見交付說明）
  t = t
    .replace(/倒數\s*[0-9]+\s*[日天]\s*[0-9]{2}:[0-9]{2}:[0-9]{2}/g, "倒數 <T>")
    .replace(/倒數\s*[0-9]{1,2}:[0-9]{2}:[0-9]{2}/g, "倒數 <T>");
  return t
    .split("\n")
    .map((l) => l.replace(/[\s\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
});

const file = path.join(OUT, `${LABEL}-copy.txt`);
fs.writeFileSync(file, text, "utf8");
console.log(`${ROUTE} → ${file}（${text.split("\n").length} 行 / ${text.length} 字）`);

await browser.close();
