import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const c = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const p = await c.newPage();
await p.goto((process.env.AUDIT_BASE ?? "http://127.0.0.1:3411") + "/", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
await p.screenshot({ path: "_audit/home-hierarchy/verify2/zoom-hero-right.png", clip: { x: 870, y: 620, width: 440, height: 320 } });
// 量一下「倒數」那行的文字與其背後元素的實際覆蓋
const info = await p.evaluate(() => {
  const card = [...document.querySelectorAll("div")].find(d => (d.textContent||"").includes("下一場定期訓練") && d.className.includes("border-l-2"));
  const r = card?.getBoundingClientRect();
  const cs = card && getComputedStyle(card);
  return { rect: r && { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, bg: cs?.backgroundColor, filter: cs?.backdropFilter };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
