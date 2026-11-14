import { chromium } from "playwright";
const BASE = "http://127.0.0.1:3399";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await p.fill("#email", "nokia@nokiatest.com");
await p.fill("#password", "nokiatest");
await p.click('button[type="submit"]');
await p.waitForTimeout(3000);

const probe = async (path) => {
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  return p.evaluate(() => {
    const de = document.documentElement;
    const h = (el) => (el ? Math.round(el.getBoundingClientRect().height) : null);
    const out = { doc: de.scrollHeight, shell: {} };
    // 全站外殼
    const header = document.querySelector("header");
    const footer = document.querySelector("footer");
    const section = document.querySelector("section");
    out.shell.header = h(header);
    out.shell.footer = h(footer);
    out.shell.section = h(section);
    const cands = [...document.querySelectorAll("div.grid > div:last-child")];
    const root = cands.sort((a, c) => c.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
    out.shell.content = h(root);
    out.chain = [];
    if (root) {
      out.chain = [...root.children].map((el) => ({
        h: h(el),
        tag: el.tagName.toLowerCase(),
        cls: (el.className ?? "").toString().slice(0, 50),
        text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30),
      }));
    }
    return out;
  });
};
console.log("AUDIT 390:", JSON.stringify(await probe("/admin/audit-log"), null, 1));
console.log("SLIDES 390:", JSON.stringify(await probe("/admin/slides"), null, 1));
await b.close();
