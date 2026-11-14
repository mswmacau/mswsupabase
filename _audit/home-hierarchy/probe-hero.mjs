import { chromium } from "playwright";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.AUDIT_BASE ?? "http://127.0.0.1:3411";
const b = await chromium.launch({ executablePath: CHROME });
for (const vp of [{ w: 390, h: 844 }, { w: 1440, h: 900 }]) {
  const c = await b.newContext({ viewport: { width: vp.w, height: vp.h } });
  const p = await c.newPage();
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await p.waitForTimeout(600);
  const rows = await p.evaluate(() => {
    const out = [];
    const hero = document.querySelector("main section");
    const walk = (el, depth) => {
      if (depth > 6) return;
      for (const ch of el.children) {
        const r = ch.getBoundingClientRect();
        if (r.height < 8) continue;
        const cs = getComputedStyle(ch);
        out.push({
          d: depth,
          tag: ch.tagName.toLowerCase(),
          h: Math.round(r.height),
          y: Math.round(r.top + scrollY),
          mb: cs.marginBottom,
          mt: cs.marginTop,
          pt: cs.paddingTop,
          pb: cs.paddingBottom,
          txt: (ch.textContent ?? "").trim().slice(0, 18),
        });
        if (ch.children.length && depth < 4) walk(ch, depth + 1);
      }
    };
    walk(hero, 0);
    return out;
  });
  console.log(`\n===== ${vp.w} =====`);
  rows.forEach((r) => {
    console.log(
      `${"  ".repeat(r.d)}<${r.tag}> h=${r.h} y=${r.y} mt=${r.mt} mb=${r.mb} pt=${r.pt} pb=${r.pb}  ${r.txt}`
    );
  });
  await c.close();
}
await b.close();
