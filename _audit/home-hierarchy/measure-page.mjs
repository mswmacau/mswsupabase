/**
 * 任意公開頁的高度／觸控／溢出／文案快照（首頁之外的頁面用）
 *
 * 用法：
 *   AUDIT_BASE=http://127.0.0.1:3412 node _audit/home-hierarchy/measure-page.mjs /about before
 *   AUDIT_BASE=http://127.0.0.1:3412 node _audit/home-hierarchy/measure-page.mjs /about after
 *
 * 產出：_audit/home-hierarchy/page-<slug>-<label>-<vw>.json 與 .png
 *       _audit/home-hierarchy/page-<slug>-<label>-text.txt（文案凍結 diff 用）
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.AUDIT_BASE ?? "http://127.0.0.1:3412";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.resolve("_audit/home-hierarchy");
const RAW = process.argv[2] ?? "about";
// Git Bash 會把 "/about" 轉成 Windows 路徑，所以兩種寫法都接受
const ROUTE = RAW.startsWith("/") ? RAW : `/${RAW}`;
const LABEL = process.argv[3] ?? "run";
const SLUG = ROUTE.replace(/[^a-z0-9]+/gi, "").toLowerCase() || "root";

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME });
const report = {};

for (const vp of [
  { name: "390", width: 390, height: 844, dsf: 2 },
  { name: "1440", width: 1440, height: 900, dsf: 1 },
]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dsf,
    isMobile: vp.width < 768,
    hasTouch: vp.width < 768,
  });
  const page = await ctx.newPage();
  const res = await page.goto(`${BASE}${ROUTE}`, { waitUntil: "networkidle", timeout: 60000 });
  if (!res || res.status() >= 400) throw new Error(`${ROUTE} 回應 ${res?.status()}`);

  const cssCheck = await page.evaluate(() => getComputedStyle(document.body).margin);
  if (cssCheck !== "0px") throw new Error(`CSS 未載入（body margin=${cssCheck}）`);

  await page.evaluate(async () => {
    const html = document.documentElement;
    html.style.scrollBehavior = "auto";
    const step = Math.round(window.innerHeight * 0.6);
    for (let y = 0; y < html.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 70));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 500));
    window.scrollTo(0, 120);
    await new Promise((r) => setTimeout(r, 160));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 450));
  });

  const height = await page.evaluate(() => document.documentElement.scrollHeight);

  const touch = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll("a,button,[role='button'],input,select,textarea")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.width < 44 || r.height < 44) {
        bad.push({
          tag: el.tagName.toLowerCase(),
          label: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 28),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    return bad;
  });

  const overflow = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return { docOverflow: document.documentElement.scrollWidth - vw };
  });

  const sections = await page.evaluate(() =>
    [...document.querySelectorAll("main section")].map((s) => ({
      h: Math.round(s.getBoundingClientRect().height),
      head: (s.querySelector("h1,h2")?.textContent ?? "").trim().slice(0, 22),
    }))
  );

  if (vp.name === "390") {
    const text = await page.evaluate(() => {
      let t = document.body.textContent ?? "";
      t = t.replace(/倒數\s*[0-9]+\s*天\s*[0-9]{2}:[0-9]{2}:[0-9]{2}/g, "倒數 <T>");
      return t
        .split("\n")
        .map((l) => l.replace(/[\s\u00a0]+/g, " ").trim())
        .filter(Boolean)
        .join("\n");
    });
    fs.writeFileSync(path.join(OUT, `page-${SLUG}-${LABEL}-text.txt`), text, "utf8");
  }

  await page.screenshot({ path: path.join(OUT, `page-${SLUG}-${LABEL}-${vp.name}.png`), fullPage: true });

  report[vp.name] = { height, screens: +(height / vp.height).toFixed(1), touch, overflow, sections };
  await ctx.close();
}

await browser.close();

const outFile = path.join(OUT, `page-${SLUG}-${LABEL}.json`);
fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");

for (const [k, v] of Object.entries(report)) {
  console.log(`\n===== ${ROUTE} @${k} =====`);
  console.log(`高度 ${v.height}px ≈ ${v.screens} 屏 | 橫向溢出 ${v.overflow.docOverflow}px`);
  console.log(`<44px 觸控目標 ${v.touch.length}`);
  v.touch.slice(0, 10).forEach((t) => console.log(`   · <${t.tag}> 「${t.label}」 ${t.w}x${t.h}`));
  console.log(`區塊：` + v.sections.map((s) => `${s.h}px${s.head ? `「${s.head}」` : ""}`).join(" / "));
}
console.log(`\n→ ${outFile}`);
