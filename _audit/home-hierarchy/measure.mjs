/**
 * 首頁層級量測（改前／改後共用同一支，確保數字可比）
 *
 * 用法：
 *   node _audit/home-hierarchy/measure.mjs <label>
 *   AUDIT_BASE=http://127.0.0.1:3411 node _audit/home-hierarchy/measure.mjs before
 *
 * 產出：
 *   _audit/home-hierarchy/<label>-390.json
 *   _audit/home-hierarchy/<label>-1440.json
 *   _audit/home-hierarchy/<label>-text.txt   （全頁文字，供文案凍結 diff）
 *   _audit/home-hierarchy/<label>-<vw>-first.png / -full.png / -focus.png
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.AUDIT_BASE ?? "http://127.0.0.1:3411";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = path.resolve("_audit/home-hierarchy");
const LABEL = process.argv[2] ?? "run";

fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "390", width: 390, height: 844, dsf: 2 },
  { name: "1440", width: 1440, height: 900, dsf: 1 },
];

/** 判定「實心主色」：背景色需接近品牌 vital / cobalt 且 alpha ≥ 0.9 */
const SOLID_PRIMARY_RGBA = [
  "rgb(227, 0, 27)", // vital
  "rgb(255, 45, 45)", // vital-bright
  "rgb(0, 71, 171)", // cobalt
  "rgb(0, 87, 255)", // cobalt-bright
];

const browser = await chromium.launch({ executablePath: CHROME });
const results = {};
let textDump = null;

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dsf,
    isMobile: vp.width < 768,
    hasTouch: vp.width < 768,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60000 });

  /* ---- 1. 確認 CSS 真的載入（body computed margin 必須 = 0px） ---- */
  const cssCheck = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return { margin: cs.margin, bg: cs.backgroundColor, font: cs.fontFamily };
  });
  if (cssCheck.margin !== "0px") {
    throw new Error(`CSS 未載入（body margin=${cssCheck.margin}）— 量測中止，數字不可信`);
  }

  /* ---- 2. 逐屏滾動觸發 reveal / scrub，再回到頂部 ----
     ⚠️ html 有 scroll-behavior: smooth，由底捲返頂要幾百 ms 動畫，
     量 y 座標時如果仲喺半路，數字全部係假。所以量測期間強制 auto。 */
  await page.evaluate(async () => {
    const html = document.documentElement;
    const prevBehavior = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    const step = Math.round(window.innerHeight * 0.6);
    const max = html.scrollHeight;
    for (let y = 0; y < max; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, max);
    await new Promise((r) => setTimeout(r, 400));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 600));
    /* Nav 係「向下捲收起、向上捲重現」的智慧導覽（useSmartNav）。
       如果量測時 Nav 剛好收埋，首屏就少了一顆按鈕 —— 數字會假好。
       所以先向下 120px、再捲返頂，確保 Nav 處於「已重現」狀態。 */
    window.scrollTo(0, 120);
    await new Promise((r) => setTimeout(r, 180));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 500));
    if (window.scrollY !== 0) window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
    html.style.scrollBehavior = prevBehavior;
  });
  const scrollY = await page.evaluate(() => window.scrollY);
  if (scrollY !== 0) throw new Error(`回到頂部失敗 scrollY=${scrollY}，數字不可信`);
  // Nav 必須可見，否則首屏 CTA 數量會少算
  const navVisible = await page.evaluate(() => {
    const h = document.querySelector("header");
    if (!h) return "no-header";
    const r = h.getBoundingClientRect();
    return r.bottom > 8 ? "visible" : "hidden";
  });
  if (navVisible !== "visible") throw new Error(`Nav 處於收合狀態（${navVisible}），首屏量測不可信`);

  /* ---- 3. 總高度 ---- */
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);

  /* ---- 4. 首屏 CTA 分析 ---- */
  const ctaAnalysis = await page.evaluate((solidColors) => {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width < 1 || r.height < 1) return null;
      if (cs.visibility === "hidden" || cs.display === "none") return null;
      if (Number(cs.opacity) < 0.3) return null;
      return r;
    };
    const nodes = [...document.querySelectorAll("a,button,[role='button']")];
    const rows = [];
    for (const el of nodes) {
      const r = isVisible(el);
      if (!r) continue;
      // 只算首屏（元素頂部落在視窗內，且水平可見）
      if (r.top > vh || r.bottom < 0) continue;
      if (r.right < 0 || r.left > vw) continue;
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      const solid = solidColors.includes(bg) && !cs.backgroundImage.includes("gradient");
      const label = (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40);
      if (!label) continue;
      const inHeader = Boolean(el.closest("header"));
      rows.push({
        label,
        href: el.getAttribute("href") ?? null,
        bg,
        solid,
        inHeader,
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
        fontSize: cs.fontSize,
      });
    }
    const solidOnes = rows.filter((r) => r.solid);
    return { vh, vw, solidCount: solidOnes.length, solidOnes, allInFirstScreen: rows };
  }, SOLID_PRIMARY_RGBA);

  /* ---- 5. 觸控目標 < 44px ---- */
  const touchTargets = await page.evaluate(() => {
    const bad = [];
    const nodes = [...document.querySelectorAll("a,button,[role='button'],input,select,textarea,[tabindex='0']")];
    for (const el of nodes) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      // 只量真正可互動（有 href / 是 button / 有 role）
      const interactive =
        el.tagName === "BUTTON" || el.tagName === "A" || el.tagName === "INPUT" ||
        el.tagName === "SELECT" || el.tagName === "TEXTAREA" ||
        el.getAttribute("role") === "button";
      if (!interactive) continue;
      if (r.width < 44 || r.height < 44) {
        bad.push({
          tag: el.tagName.toLowerCase(),
          label: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30),
          w: Math.round(r.width),
          h: Math.round(r.height),
          y: Math.round(r.top + window.scrollY),
        });
      }
    }
    return bad;
  });

  /* ---- 6. 橫向溢出 ---- */
  const overflow = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const docOverflow = document.documentElement.scrollWidth - vw;
    /** 被祖先 overflow 裁掉的元素不算「溢出」（例如輪播的橫向軌道本來就會超出） */
    const isClipped = (el) => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        if (["hidden", "clip", "auto", "scroll"].includes(cs.overflowX)) return true;
        p = p.parentElement;
      }
      return false;
    };
    const offenders = [];
    for (const el of [...document.querySelectorAll("body *")]) {
      const cs = getComputedStyle(el);
      if (cs.pointerEvents === "none") continue; // 裝飾層不算
      const r = el.getBoundingClientRect();
      if (r.width < 1) continue;
      if (r.right <= vw + 1) continue;
      if (isClipped(el)) continue;
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || "").toString().slice(0, 70),
        right: Math.round(r.right),
      });
    }
    return { vw, docOverflow, offenders: offenders.slice(0, 15), offenderCount: offenders.length };
  });

  /* ---- 7. 各區塊高度（找最重的幾塊） ---- */
  const sections = await page.evaluate(() => {
    return [...document.querySelectorAll("main > section, main > div > section, main section")].map((s, i) => {
      const r = s.getBoundingClientRect();
      const h2 = s.querySelector("h1,h2");
      return {
        i,
        h: Math.round(r.height),
        top: Math.round(r.top + window.scrollY),
        head: (h2?.textContent ?? "").trim().slice(0, 24),
      };
    });
  });

  /* ---- 8. 全頁文字（含折疊內容） ---- */
  if (vp.name === "390") {
    textDump = await page.evaluate(() => {
      // textContent 會包含 display:none / aria-hidden 的內容 → 折疊區塊文字一併抓到
      let t = document.body.textContent ?? "";
      // 倒數每秒變動：正規化成固定佔位，讓改前改後的 diff 只反映真實文案變動
      t = t.replace(/倒數\s*[0-9]+\s*天\s*[0-9]{2}:[0-9]{2}:[0-9]{2}/g, "倒數 <T>");
      t = t.replace(/倒數\s*[0-9]{2}:[0-9]{2}:[0-9]{2}/g, "倒數 <T>");
      return t
        .split("\n")
        .map((l) => l.replace(/[\s\u00a0]+/g, " ").trim())
        .filter(Boolean)
        .join("\n");
    });
  }

  /* ---- 9. 截圖 ---- */
  await page.screenshot({ path: path.join(OUT, `${LABEL}-${vp.name}-first.png`), fullPage: false });
  await page.screenshot({ path: path.join(OUT, `${LABEL}-${vp.name}-full.png`), fullPage: true });

  // focus 態：把焦點放到首屏主 CTA（沒有就放第一個 main 內的連結）
  const focused = await page.evaluate(() => {
    const solid = ["rgb(227, 0, 27)", "rgb(255, 45, 45)", "rgb(0, 71, 171)", "rgb(0, 87, 255)"];
    const cands = [...document.querySelectorAll("main a, main button")];
    const target =
      cands.find((el) => solid.includes(getComputedStyle(el).backgroundColor)) ?? cands[0];
    if (!target) return null;
    target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
    const r = target.getBoundingClientRect();
    return { label: (target.textContent || "").trim().slice(0, 30), x: r.left, y: r.top, w: r.width, h: r.height };
  });
  if (focused) {
    await page.waitForTimeout(250);
    const clipPad = 40;
    await page.screenshot({
      path: path.join(OUT, `${LABEL}-${vp.name}-focus.png`),
      clip: {
        x: Math.max(0, focused.x - clipPad),
        y: Math.max(0, focused.y - clipPad),
        width: Math.min(vp.width, focused.w + clipPad * 2),
        height: Math.min(vp.height, focused.h + clipPad * 2),
      },
    });
  }

  results[vp.name] = {
    viewport: `${vp.width}x${vp.height}`,
    cssCheck,
    pageHeight,
    screens: +(pageHeight / vp.height).toFixed(1),
    cta: ctaAnalysis,
    touchTargetsUnder44: touchTargets,
    overflow,
    sections,
    focusTarget: focused,
  };

  await context.close();
}

await browser.close();

for (const [k, v] of Object.entries(results)) {
  fs.writeFileSync(path.join(OUT, `${LABEL}-${k}.json`), JSON.stringify(v, null, 2), "utf8");
}
if (textDump) {
  fs.writeFileSync(path.join(OUT, `${LABEL}-text.txt`), textDump, "utf8");
}

/* ---- 終端摘要 ---- */
for (const [k, v] of Object.entries(results)) {
  console.log(`\n========== ${k} (${v.viewport}) ==========`);
  console.log(`總高度 ${v.pageHeight}px  ≈ ${v.screens} 屏`);
  console.log(`CSS 載入確認 body margin=${v.cssCheck.margin} bg=${v.cssCheck.bg}`);
  console.log(`首屏實心主色 CTA 數量: ${v.cta.solidCount}`);
  for (const s of v.cta.solidOnes) {
    console.log(`   · 「${s.label}」 y=${s.y} x=${s.x} ${s.w}x${s.h} bg=${s.bg} ${s.inHeader ? "(header)" : "(main)"} → ${s.href}`);
  }
  console.log(`<44px 觸控目標: ${v.touchTargetsUnder44.length}`);
  for (const t of v.touchTargetsUnder44.slice(0, 12)) {
    console.log(`   · <${t.tag}> 「${t.label}」 ${t.w}x${t.h} @y=${t.y}`);
  }
  console.log(`橫向溢出: doc ${v.overflow.docOverflow}px, 元素 ${v.overflow.offenderCount} 個`);
  for (const o of v.overflow.offenders.slice(0, 6)) console.log(`   · <${o.tag}> right=${o.right} ${o.cls}`);
  console.log(`最大 6 個區塊:`);
  [...v.sections].sort((a, b) => b.h - a.h).slice(0, 6).forEach((s) => {
    console.log(`   · ${s.h}px  「${s.head || "(無標題)"}」 @y=${s.top}`);
  });
}

fs.writeFileSync(path.join(OUT, `${LABEL}-summary.json`), JSON.stringify(results, null, 2), "utf8");
console.log(`\n產出已寫入 ${OUT}`);
