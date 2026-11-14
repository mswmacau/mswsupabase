/**
 * focus 態截圖 + 可程式化驗證
 *
 * 難點：`:focus-visible` 由瀏覽器依「最後一次互動是否鍵盤」決定，
 * 純程式化 .focus() 未必會命中。所以先按一次 Tab（讓最後互動＝鍵盤），
 * 再把焦點移到目標元素，並實際讀回 computed outline 佐證。
 *
 * 用法：AUDIT_BASE=http://127.0.0.1:3412 node _audit/home-hierarchy/focus-shot.mjs
 */
import { chromium } from "playwright";
import path from "node:path";

const BASE = process.env.AUDIT_BASE ?? "http://127.0.0.1:3412";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.resolve("_audit/home-hierarchy");

const browser = await chromium.launch({ executablePath: CHROME });

for (const vp of [
  { name: "390", width: 390, height: 844, dsf: 2 },
  { name: "1440", width: 1440, height: 900, dsf: 1 },
]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dsf,
    isMobile: false, // 用桌機語意才能穩定測 keyboard focus
    hasTouch: false,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // 1) 先按 Tab → 讓「最後互動 = 鍵盤」，之後程式化 focus 才會命中 :focus-visible
  await page.keyboard.press("Tab");

  // 2) 把焦點移到首屏那顆實心主色 CTA，並用「instant」定位（避免 smooth scroll 半路）
  const info = await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    const solid = ["rgb(227, 0, 27)", "rgb(255, 45, 45)", "rgb(0, 71, 171)", "rgb(0, 87, 255)"];
    const target =
      [...document.querySelectorAll("main a, main button")].find((el) =>
        solid.includes(getComputedStyle(el).backgroundColor)
      ) ?? document.querySelector("main a");
    if (!target) return null;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center", behavior: "instant" });
    return { label: (target.textContent || "").trim().slice(0, 30) };
  });

  await page.waitForTimeout(400);

  const style = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      label: (el.textContent || "").trim().slice(0, 30),
      matchesFocusVisible: el.matches(":focus-visible"),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor,
      outlineOffset: cs.outlineOffset,
      boxShadow: cs.boxShadow,
      bg: cs.backgroundColor,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    };
  });

  const pad = 46;
  const x = Math.max(0, style.rect.x - pad);
  const y = Math.max(0, style.rect.y - pad);
  await page.screenshot({
    path: path.join(OUT, `focus-${vp.name}.png`),
    clip: {
      x,
      y,
      width: Math.min(vp.width - x, style.rect.w + pad * 2),
      height: Math.min(vp.height - y, style.rect.h + pad * 2),
    },
  });

  console.log(`\n===== ${vp.name} =====`);
  console.log(`目標：<${style.tag}>「${style.label}」 matches :focus-visible = ${style.matchesFocusVisible}`);
  console.log(`outline: ${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor} offset=${style.outlineOffset}`);
  console.log(`box-shadow: ${style.boxShadow}`);
  console.log(`按鈕底色: ${style.bg}`);

  await ctx.close();
}

await browser.close();
