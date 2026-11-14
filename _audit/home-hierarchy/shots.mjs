import { chromium } from "playwright";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.AUDIT_BASE ?? "http://127.0.0.1:3412";
const OUT = "_audit/home-hierarchy";
const b = await chromium.launch({ executablePath: CHROME });
const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const p = await c.newPage();
await p.goto(BASE + "/", { waitUntil: "networkidle" });
await p.evaluate(async () => {
  document.documentElement.style.scrollBehavior = "auto";
  const step = Math.round(innerHeight * 0.6);
  for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
    scrollTo(0, y); await new Promise(r => setTimeout(r, 80));
  }
  scrollTo(0, 0); await new Promise(r => setTimeout(r, 600));
});
const H = await p.evaluate(() => document.documentElement.scrollHeight);
// 分成 3 段，每段約 1/3 頁高，方便逐段檢視
const seg = Math.ceil(H / 3);
for (let i = 0; i < 3; i++) {
  await p.screenshot({ path: `${OUT}/seg-${i}.png`, fullPage: true, clip: { x: 0, y: i * seg, width: 390, height: Math.min(seg, H - i * seg) } });
}
console.log("H=", H, "seg=", seg);
await b.close();
