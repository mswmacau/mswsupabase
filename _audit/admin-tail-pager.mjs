import { chromium } from "playwright";
const BASE = "http://127.0.0.1:3399";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const b = await chromium.launch({ executablePath: CHROME });
for (const vp of [{ k: "390", w: 390, h: 844 }, { k: "1440", w: 1440, h: 900 }]) {
  const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await p.fill("#email", "nokia@nokiatest.com");
  await p.fill("#password", "nokiatest");
  await p.click('button[type="submit"]');
  await p.waitForTimeout(2500);
  await p.goto(`${BASE}/admin/audit-log?page=2`, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  const nav = p.locator('nav[aria-label="操作紀錄分頁"]');
  const boxes = {};
  for (const [label, sel] of [["上一頁", 'a[aria-label^="上一頁"]'], ["下一頁", 'a[aria-label^="下一頁"]']]) {
    const el = nav.locator(sel).first();
    boxes[label] = (await el.count()) ? await el.boundingBox() : null;
  }
  const row = await p.evaluate(() => {
    const li = document.querySelector("ul.md\\:hidden > li");
    const btn = document.querySelector('nav[aria-label="操作紀錄分頁"] p');
    return { card: li ? Math.round(li.getBoundingClientRect().height) : null, status: btn ? btn.innerText.trim() : null };
  });
  console.log(vp.k, JSON.stringify({ ...boxes, ...row }));
  await ctx.close();
}
await b.close();
