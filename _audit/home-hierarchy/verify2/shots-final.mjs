/**
 * 交付用截圖：首屏 / 全頁 / 區塊分段（供視覺主次自評）
 * 用法：AUDIT_BASE=http://127.0.0.1:3411 node _audit/home-hierarchy/verify2/shots-final.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.AUDIT_BASE ?? "http://127.0.0.1:3411";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.resolve("_audit/home-hierarchy/verify2");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME });

for (const vp of [
  { name: "390", width: 390, height: 844, dsf: 2 },
  { name: "1440", width: 1440, height: 900, dsf: 1 },
]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dsf,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60000 });
  const cssOk = await page.evaluate(() => getComputedStyle(document.body).margin);
  if (cssOk !== "0px") throw new Error(`CSS 未載入（body margin=${cssOk}）— 截圖不可信`);

  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = "auto";
    const step = Math.round(innerHeight * 0.6);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 900));
  });

  await page.screenshot({ path: path.join(OUT, `final-${vp.name}-first.png`) });
  await page.screenshot({ path: path.join(OUT, `final-${vp.name}-full.png`), fullPage: true });

  // 分段：按 section 邊界切，方便逐段看「相鄰區塊是否撞臉」
  const sections = await page.evaluate(() =>
    [...document.querySelectorAll("main section, body > section")].map((s) => {
      const r = s.getBoundingClientRect();
      return {
        top: Math.round(r.top + window.scrollY),
        h: Math.round(r.height),
        bg: getComputedStyle(s).backgroundColor,
        head: (s.querySelector("h1,h2")?.textContent ?? "(無標題)").trim().slice(0, 20),
      };
    })
  );
  fs.writeFileSync(path.join(OUT, `final-${vp.name}-sections.json`), JSON.stringify(sections, null, 2));
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    await page.screenshot({
      path: path.join(OUT, `final-${vp.name}-sec${i + 1}.png`),
      clip: { x: 0, y: s.top, width: vp.width, height: Math.min(s.h, 2400) },
      fullPage: true,
    });
  }
  console.log(`${vp.name}: ${sections.length} 段`);
  for (const s of sections) console.log(`   ${s.h}px bg=${s.bg} 「${s.head}」`);

  await ctx.close();
}

await browser.close();
