import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await c.newPage();
await p.goto((process.env.AUDIT_BASE ?? "http://127.0.0.1:3411") + "/", { waitUntil: "networkidle" });
await p.waitForTimeout(500);
const margin = await p.evaluate(() => getComputedStyle(document.body).margin);
if (margin !== "0px") throw new Error("CSS 未載入");
for (let i = 0; i < 4; i++) await p.keyboard.press("Tab");
await p.waitForTimeout(400);
const info = await p.evaluate(() => {
  const el = document.activeElement; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  return { label: el.getAttribute("aria-label"), clip: cs.clipPath, outline: cs.outline, shadow: cs.boxShadow, x: r.left, y: r.top, w: r.width, h: r.height };
});
console.log(JSON.stringify(info));
const pad = 14;
await p.screenshot({ path: process.argv[2] ?? "_audit/home-hierarchy/verify2/shot-hamburger.png", clip: { x: Math.max(0, info.x - pad), y: Math.max(0, info.y - pad), width: info.w + pad * 2, height: info.h + pad * 2 } });
await b.close();
