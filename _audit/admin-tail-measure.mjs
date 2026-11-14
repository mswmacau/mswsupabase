// /admin/audit-log 與 /admin/slides 手機／桌面收尾量測（admin-tail）
// 用法：node _audit/admin-tail-measure.mjs
// 前提：next build 完成，`npx next start -p 3399` 已啟動（AUDIT_BASE 可覆寫）
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.AUDIT_BASE ?? "http://127.0.0.1:3399";
const OUT = "C:/Users/nokia/WorkBuddy/MSW WEBSITE/_audit/admin-tail";
fs.mkdirSync(OUT, { recursive: true });

// 這台機器沒有 playwright 的 chromium，沿用系統 Chrome（與既有量測腳本一致）
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const VIEWPORTS = [
  { key: "390", width: 390, height: 844 },
  { key: "1440", width: 1440, height: 900 },
];

const report = { base: BASE, measuredAt: new Date().toISOString(), pages: {}, flow: {}, css: {}, notes: [] };

const browser = await chromium.launch({ executablePath: CHROME });

/** 登入（admin） */
async function newPage(vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", "nokia@nokiatest.com");
  await page.fill("#password", "nokiatest");
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(1200);
  return { context, page };
}

/** 頁面量測：整頁高度、橫向溢出、可點元素尺寸（只量內容區，不含側欄／全站 header） */
async function measure(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const root = document.querySelector("div.grid > div:last-child") ?? document.body;

    const SEL =
      'a[href], button, [role="button"], input:not([type="hidden"]), select, textarea, summary, label:has(input), [role="switch"]';
    const targets = [];
    for (const el of root.querySelectorAll(SEL)) {
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      // checkbox／radio 的實際點擊區是外層 label（已納入 SEL）
      if (el.tagName === "INPUT" && (type === "checkbox" || type === "radio")) continue;
      const rect = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (rect.width === 0 || rect.height === 0) continue;
      if (st.visibility === "hidden" || st.display === "none") continue;
      if (Number(st.opacity) === 0) continue;
      const text =
        (el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          (el.textContent ?? "").trim().replace(/\s+/g, " ")).slice(0, 60) ||
        `[${el.tagName.toLowerCase()}]`;
      targets.push({
        tag: el.tagName.toLowerCase(),
        text,
        w: Math.round(rect.width * 10) / 10,
        h: Math.round(rect.height * 10) / 10,
      });
    }

    const css = getComputedStyle(document.body);
    return {
      docHeight: de.scrollHeight,
      bodyHeight: document.body.scrollHeight,
      viewport: { w: de.clientWidth, h: window.innerHeight },
      screens: Math.round((de.scrollHeight / window.innerHeight) * 100) / 100,
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      overflow: de.scrollWidth - de.clientWidth,
      cssBodyMargin: css.margin,
      cssSheets: document.styleSheets.length,
      targets,
    };
  });
}

function offenders(m, min) {
  return m.targets.filter((t) => t.h < min).sort((a, b) => a.h - b.h);
}

/* ============================================================
 * 1) /admin/audit-log
 * ============================================================ */
for (const vp of VIEWPORTS) {
  const { context, page } = await newPage(vp);
  const posts = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") posts.push(`${r.method()} ${r.url()}`);
  });

  // --- 第 1 頁 ---
  await page.goto(`${BASE}/admin/audit-log`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const p1 = await measure(page);
  const pagerText = async () =>
    (await page.locator('nav[aria-label="操作紀錄分頁"] p').first().innerText().catch(() => "")).trim();

  const firstPagerText = await pagerText();
  const prevIsDisabled = (await page.locator('nav[aria-label="操作紀錄分頁"] [aria-disabled="true"]').count()) > 0;
  const cardHeights = await page.evaluate(() =>
    [...document.querySelectorAll("ul.md\\:hidden > li")].map((li) =>
      Math.round(li.getBoundingClientRect().height)
    )
  );
  const tableRows = await page.locator("table tbody tr").count();

  await page.screenshot({ path: `${OUT}/${vp.key}-audit-log-p1.png`, fullPage: true });
  await page.screenshot({ path: `${OUT}/${vp.key}-audit-log-p1-viewport.png`, fullPage: false });

  // --- 逐頁翻到最後一頁 ---
  let pages = 1;
  const perPageRows = [];
  const nextSel = 'nav[aria-label="操作紀錄分頁"] a[aria-label^="下一頁"]';
  while (pages < 60) {
    const next = page.locator(nextSel).first();
    if ((await page.locator(nextSel).count()) === 0) break;
    await next.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(700);
    pages += 1;
    perPageRows.push(await page.locator("ul.md\\:hidden > li").count());
  }

  const last = await measure(page);
  const lastPagerText = await pagerText();
  const lastUrl = page.url();
  const lastCardCount = await page.locator("ul.md\\:hidden > li").count();
  const nextIsDisabled =
    (await page.locator('nav[aria-label="操作紀錄分頁"] span[aria-disabled="true"]').count()) > 0;
  // 最後一頁的最後一筆卡片摘要（證明真的看得到）
  const lastCardText = (
    await page
      .locator("ul.md\\:hidden > li")
      .last()
      .innerText()
      .catch(() => "")
  )
    .replace(/\s+/g, " ")
    .slice(0, 120);

  await page.screenshot({ path: `${OUT}/${vp.key}-audit-log-last.png`, fullPage: true });

  // --- 越界保護：?page=999 ---
  await page.goto(`${BASE}/admin/audit-log?page=999`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const clampPagerText = await pagerText();
  const clampUrl = page.url();

  report.pages[`${vp.key}-audit-log`] = {
    initial: {
      docHeight: p1.docHeight,
      screens: p1.screens,
      overflow: p1.overflow,
      targets: p1.targets.length,
      under44: offenders(p1, 44).length,
      under36: offenders(p1, 36).length,
      offenders: vp.width < 768 ? offenders(p1, 44) : offenders(p1, 36),
      pagerText: firstPagerText,
      prevIsDisabled,
      mobileCardHeights: cardHeights.slice(0, 5),
      mobileCardCount: cardHeights.length,
      desktopTableRows: tableRows,
    },
    lastPage: {
      docHeight: last.docHeight,
      screens: last.screens,
      overflow: last.overflow,
      pagerText: lastPagerText,
      cardCount: lastCardCount,
      nextIsDisabled,
      url: lastUrl,
      lastCardText,
    },
    paging: { totalPagesWalked: pages, rowsPerPageAfterFirst: perPageRows },
    clamp: { url: clampUrl, pagerText: clampPagerText },
  };
  report.css[`${vp.key}-audit-log`] = { bodyMargin: p1.cssBodyMargin, sheets: p1.cssSheets };
  report.flow[`${vp.key}-audit-log-writes`] = posts;

  await context.close();
}

/* ============================================================
 * 2) /admin/slides
 * ============================================================ */
for (const vp of VIEWPORTS) {
  const { context, page } = await newPage(vp);
  const posts = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") posts.push(`${r.method()} ${r.url()}`);
  });

  await page.goto(`${BASE}/admin/slides`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000); // 等掛載後的 GET /api/admin/slides 對帳

  const m = await measure(page);

  // 區塊高度分解（找出高度主因）
  const breakdown = await page.evaluate(() => {
    const root = document.querySelector("div.grid > div:last-child");
    if (!root) return null;
    const blocks = [...root.children].map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: (el.className ?? "").toString().slice(0, 70),
      h: Math.round(el.getBoundingClientRect().height),
    }));
    const lists = [...root.querySelectorAll("ul")].map((ul) => ({
      cls: (ul.className ?? "").toString().slice(0, 70),
      visible: ul.getBoundingClientRect().height > 0,
      h: Math.round(ul.getBoundingClientRect().height),
      rowHeights: [...ul.children].map((li) => Math.round(li.getBoundingClientRect().height)),
    }));
    return { blocks, lists, scrollH: document.documentElement.scrollHeight };
  });

  await page.screenshot({ path: `${OUT}/${vp.key}-slides.png`, fullPage: true });
  await page.screenshot({ path: `${OUT}/${vp.key}-slides-viewport.png`, fullPage: false });

  // 展開／收合測試（只開面板，不改資料）
  // 手機列式版型只在 <768px 顯示；桌面是攤平的表單卡，沒有展開這回事。
  const rowButtons = page.locator('button[aria-controls^="slide-panel-"]');
  const rowCount = vp.width < 768 ? await rowButtons.count() : 0;
  let expand = null;
  if (rowCount > 0) {
    await rowButtons.first().click();
    await page.waitForTimeout(500);
    const panel = page.locator('div[id^="slide-panel-"]').first();
    const panelVisible = await panel.isVisible().catch(() => false);
    const expandedHeight = (await measure(page)).docHeight;
    const ariaExpanded = await rowButtons.first().getAttribute("aria-expanded");
    await page.screenshot({ path: `${OUT}/${vp.key}-slides-expanded.png`, fullPage: true });

    await rowButtons.first().click();
    await page.waitForTimeout(400);
    const panelClosed = !(await panel.isVisible().catch(() => false));
    const collapsedAgain = (await measure(page)).docHeight;

    expand = { rowCount, panelVisible, ariaExpanded, expandedHeight, panelClosed, collapsedAgain };
  }

  report.pages[`${vp.key}-slides`] = {
    initial: {
      docHeight: m.docHeight,
      screens: m.screens,
      overflow: m.overflow,
      targets: m.targets.length,
      under44: offenders(m, 44).length,
      under36: offenders(m, 36).length,
      offenders: vp.width < 768 ? offenders(m, 44) : offenders(m, 36),
    },
    breakdown,
    expand,
  };
  report.css[`${vp.key}-slides`] = { bodyMargin: m.cssBodyMargin, sheets: m.cssSheets };
  report.flow[`${vp.key}-slides-writes`] = posts;

  await context.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/measure.json`, JSON.stringify(report, null, 2));

/* ---- 主控台摘要 ---- */
for (const [k, v] of Object.entries(report.pages)) {
  const i = v.initial;
  console.log(
    `${k}: 高度=${i.docHeight}px (${i.screens} 屏) overflow=${i.overflow} targets=${i.targets} <44=${i.under44} <36=${i.under36}`
  );
  if (v.lastPage) {
    console.log(
      `   最後一頁: 高度=${v.lastPage.docHeight} "${v.lastPage.pagerText}" 卡片=${v.lastPage.cardCount} 下一頁停用=${v.lastPage.nextIsDisabled} 走了 ${v.paging.totalPagesWalked} 頁`
    );
    console.log(`   越界 ?page=999 → ${v.clamp.url} "${v.clamp.pagerText}"`);
    console.log(`   最後一筆: ${v.lastPage.lastCardText}`);
  }
  if (v.expand) console.log(`   展開: ${JSON.stringify(v.expand)}`);
  for (const o of i.offenders ?? []) console.log(`   <尺寸> ${o.h}px ${o.tag} ${o.text}`);
}
console.log("\nCSS:", JSON.stringify(report.css));
console.log("非 GET 請求（應為空）:", JSON.stringify(report.flow));
