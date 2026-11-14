/**
 * focus 可見性專項驗證（鍵盤 Tab 進入，不是 JS .focus()）
 *
 * 只測「首屏主 CTA / Nav 立即加入 / 次要按鈕」三顆，
 * 逐級 Tab 到目標後截圖 + 記錄 computed outline / box-shadow。
 *
 * 用法：AUDIT_BASE=http://127.0.0.1:3411 node _audit/home-hierarchy/verify2/focus-check.mjs after
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.AUDIT_BASE ?? "http://127.0.0.1:3411";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.resolve("_audit/home-hierarchy/verify2");
fs.mkdirSync(OUT, { recursive: true });
const LABEL = process.argv[2] ?? "run";

const browser = await chromium.launch({ executablePath: CHROME });
const report = {};

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
  await page.waitForTimeout(600);

  // CSS 未載入時所有量測都是假的（曾因他人並行 build 覆蓋 .next 導致 CSS 404）
  const cssOk = await page.evaluate(() => getComputedStyle(document.body).margin);
  if (cssOk !== "0px") {
    throw new Error(`CSS 未載入（body margin=${cssOk}）— 中止，結果不可信`);
  }

  // 用 Tab 走訪，收集每個可聚焦元素的 focus 樣式
  const seen = [];
  const maxTabs = 26;
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(120);
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        label: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24),
        href: el.getAttribute("href"),
        outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`,
        boxShadow: cs.boxShadow,
        clipPath: cs.clipPath,
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
      };
    });
    if (!info) break;
    seen.push(info);

    // 對首屏三顆關鍵按鈕截圖
    const key = /立即加入會員|立即加入|查看活動/.test(info.label) && info.inViewport;
    if (key) {
      const pad = 26;
      await page.screenshot({
        path: path.join(OUT, `${LABEL}-${vp.name}-focus-${info.label.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "")}.png`),
        clip: {
          x: Math.max(0, info.rect.x - pad),
          y: Math.max(0, info.rect.y - pad),
          width: Math.min(vp.width - Math.max(0, info.rect.x - pad), info.rect.w + pad * 2),
          height: info.rect.h + pad * 2,
        },
      });
      // 順手記 pixel 對比：抓按鈕左邊界外 2px 那條線的顏色
      const ringPixel = await page.evaluate(async () => {
        const el = document.activeElement;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top + r.height / 2) };
      });
      info.ringProbeAt = ringPixel;
    }
  }

  report[vp.name] = seen;
  await ctx.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT, `${LABEL}-focus.json`), JSON.stringify(report, null, 2), "utf8");

for (const [vp, rows] of Object.entries(report)) {
  console.log(`\n===== ${vp} =====`);
  for (const r of rows) {
    console.log(
      `${r.label.padEnd(16)} outline=[${r.outline}] clip=${r.clipPath === "none" ? "no" : "YES"} y=${r.rect.y} ${r.rect.w}x${r.rect.h}`
    );
    console.log(`   box-shadow=${r.boxShadow}`);
  }
}
