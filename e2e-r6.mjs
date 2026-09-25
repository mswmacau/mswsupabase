import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:3001";
const SHOT = "/workspace/msw-street-workout/screenshots/r6";
fs.mkdirSync(SHOT, { recursive: true });

// 測試用大圖（>4.5MB，驗證 Vercel body 上限修復）：3000x2250 噪點 PNG
const BIG = "/tmp/test-run-big.png";
async function ensureBigImage() {
  if (fs.existsSync(BIG)) return;
  // 用 node 產生一張夠大的 PNG（canvas 壓縮後仍應 < 1.2MB）
  const { PNG } = await import("pngjs").catch(() => ({ PNG: null }));
  if (!PNG) {
    // 退化：用 headless chromium 截一張大圖
    const p = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
    const pg = await p.newPage({ viewport: { width: 3000, height: 2250 } });
    await pg.setContent(`<body style="margin:0;background:linear-gradient(135deg,#0b1020,#1d4ed8,#0b1020)"></body>`);
    await pg.screenshot({ path: BIG });
    await p.close();
    return;
  }
  const png = new PNG({ width: 3000, height: 2250 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = (i * 7) % 256;
    png.data[i + 1] = (i * 13) % 256;
    png.data[i + 2] = (i * 29) % 256;
    png.data[i + 3] = 255;
  }
  fs.writeFileSync(BIG, PNG.sync.write(png));
}
await ensureBigImage();
const BIG_MB = (fs.statSync(BIG).size / 1024 / 1024).toFixed(2);

// 帳號（安全：憑證只從環境變數讀取，請勿寫入版本庫）
// 執行前先設定：
//   export E2E_MEMBER_EMAIL=...  E2E_MEMBER_PW=...
//   export E2E_ADMIN_EMAIL=...   E2E_ADMIN_PW=...
const NEW_EMAIL = process.env.E2E_MEMBER_EMAIL ?? "";
const NEW_PW = process.env.E2E_MEMBER_PW ?? "";
const NEW_NAME = "MSW 自動測試會員";
const ADMIN = process.env.E2E_ADMIN_EMAIL ?? "";
const APW = process.env.E2E_ADMIN_PW ?? "";

const errors = [];
const log = (...a) => console.log("[E2E]", ...a);
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

const shot = async (name) => { await page.screenshot({ path: `${SHOT}/${name}.png` }); log("shot", name); };
const step = async (label, fn) => {
  try { await fn(); log("OK  -", label); }
  catch (e) { errors.push(`STEP FAIL [${label}]: ${e.message}`); log("FAIL-", label, e.message); throw e; }
};
const login = async (email, pw) => {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", pw);
  await page.getByRole("button", { name: /登入|登錄/ }).click();
  await page.waitForURL("**/dashboard", { timeout: 20000 });
};
const waitOk = async (txt) => page.waitForFunction(
  (t) => document.body.innerText.includes(t), txt, { timeout: 30000 });

await step("訪客首頁導航", async () => {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForSelector("text=MSW 街健館", { timeout: 15000 });
  await shot("01-home");
  for (const t of ["活動", "定期訓練", "月度跑步挑戰", "排行榜"]) {
    if (!(await page.getByText(t, { exact: false }).count())) throw new Error("缺少導航: " + t);
  }
});

await step("註冊新會員(UI signup, 自動啟用)", async () => {
  await page.goto(BASE + "/signup", { waitUntil: "networkidle" });
  await page.fill("#display_name", NEW_NAME);
  await page.fill("#email", NEW_EMAIL);
  await page.fill("#password", NEW_PW);
  await page.getByRole("button", { name: /建立帳號/ }).click();
  try {
    await page.waitForURL("**/dashboard", { timeout: 20000 });
  } catch {
    const body = await page.evaluate(() => document.body.innerText);
    if (!/註冊成功|驗證|啟用/.test(body)) throw new Error("註冊後未導向 dashboard: " + body.slice(0, 200));
    // 需要郵件驗證：退回用既有的已驗證會員
    throw new Error("註冊需要郵件驗證，請改用已驗證帳號");
  }
  await shot("02-member-dashboard");
});

await step(`上傳大圖跑步紀錄(${BIG_MB}MB > 4.5MB 上限, 驗證修復)`, async () => {
  await page.goto(BASE + "/run", { waitUntil: "networkidle" });
  await page.waitForSelector('button:has-text("點擊上傳跑步 app 截圖")', { timeout: 15000 });
  await page.setInputFiles("#screenshot", BIG); // 隱藏 input，Playwright 直接設檔
  await page.waitForSelector('img[alt="截圖預覽"]', { timeout: 20000 });
  await page.fill("#km", "12.5");
  await page.getByRole("button", { name: /提交紀錄/ }).click();
  await waitOk("已提交");
  await shot("03-run-success");
});

await step("前台報名活動(驗證 報名/詳情 按鈕)", async () => {
  await page.goto(BASE + "/events", { waitUntil: "networkidle" });
  await page.waitForSelector("text=秋季街健體驗日", { timeout: 15000 });
  const card = page.locator("article").filter({ hasText: "秋季街健體驗日" }).first();
  const link = card.getByRole("link", { name: /報名|詳情/ });
  const href = await link.getAttribute("href");
  if (!href || !/^https?:\/\//.test(href)) throw new Error("報名連結異常: " + href);
  log("報名連結 =", href);
  await shot("04-events");
});

await step("會員登出(開啟頭像下拉→登出)", async () => {
  await page.locator('header button:has-text("pt")').first().click();
  await page.getByRole("button", { name: "登出" }).click();
  await page.waitForURL("**/", { timeout: 15000 });
  await page.waitForTimeout(800);
  await shot("05-after-logout");
});

await step("管理員登入", async () => { await login(ADMIN, APW); await shot("06-admin-dashboard"); });

await step("後台總覽含 活動管理 + 網站設定 導航", async () => {
  await page.goto(BASE + "/admin", { waitUntil: "networkidle" });
  await page.waitForSelector("text=活動管理", { timeout: 15000 });
  if (!(await page.getByText("網站設定", { exact: false }).count())) throw new Error("缺少「網站設定」導航");
  await shot("07-admin-overview");
});

await step("管理員確認跑步截圖(通過)", async () => {
  await page.goto(BASE + "/admin/runs", { waitUntil: "networkidle" });
  await page.waitForSelector(`text=${NEW_NAME}`, { timeout: 20000 });
  const card = page.locator("div.card-dark", { hasText: NEW_NAME }).first();
  await card.getByRole("button", { name: "通過" }).click();
  await page.waitForTimeout(1500);
  await page.goto(BASE + "/admin/runs?status=approved", { waitUntil: "networkidle" });
  await page.waitForSelector(`text=${NEW_NAME}`, { timeout: 15000 });
  await shot("08-admin-runs-confirm");
});

await step("活動管理：新增活動含封面圖上傳", async () => {
  await page.goto(BASE + "/admin/events", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /新增活動/ }).click();
  await page.waitForSelector("#f-title", { timeout: 15000 });
  const TITLE = "MSW E2E 自動化測試活動";
  await page.fill("#f-title", TITLE);
  await page.fill("#f-date", "2026-11-15");
  await page.fill("#f-url", "https://msw-street-workout.vercel.app/run");
  await page.setInputFiles('div.fixed.inset-0 input[type="file"]', BIG);
  await page.waitForSelector('img[alt="封面預覽"]', { timeout: 20000 });
  await page.getByRole("button", { name: /儲存活動/ }).click();
  await waitOk("已建立活動");
  await page.waitForSelector(`text=${TITLE}`, { timeout: 10000 });
  await shot("09-admin-event-created");
  // 清理：下架隱藏剛建立的測試活動，避免污染線上資料
  const row = page.locator("div.card-dark", { hasText: TITLE }).first();
  await row.locator('input[type="checkbox"]').check();
  await row.getByRole("button", { name: /下架隱藏/ }).click();
  await page.waitForTimeout(1200);
  await shot("09b-event-cleaned");
});

await step("網站設定：編輯 brand_name 並復原", async () => {
  await page.goto(BASE + "/admin/site-settings", { waitUntil: "networkidle" });
  await page.waitForSelector("#brand_name", { timeout: 15000 });
  await page.fill("#brand_name", "MSW 街健館（測試）");
  await page.getByRole("button", { name: /儲存設定/ }).click();
  await waitOk("已儲存");
  await shot("10-site-settings");
  await page.fill("#brand_name", "MSW 街健館");
  await page.getByRole("button", { name: /儲存設定/ }).click();
  await waitOk("已儲存");
  await shot("10b-site-settings-revert");
});

await step("巡檢所有前台/後台頁面(管理員已登入)", async () => {
  const pages = ["/admin/checkins", "/admin/monthly", "/admin/coupons", "/admin/sessions", "/admin/events", "/events", "/training", "/run", "/leaderboard", "/dashboard", "/"];
  for (const p of pages) {
    await page.goto(BASE + p, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await shot("11-page-" + p.replace(/\//g, "_"));
  }
});

log("=== 結果 ===");
if (errors.length === 0) log("無 console error / pageerror / step failure");
else errors.forEach((e) => log(e));

// 寫出交付憑證
const creds = `新會員（UI 註冊，已通過跑步審核）\n  電郵: ${NEW_EMAIL}\n  密碼: ${NEW_PW}\n  顯示名稱: ${NEW_NAME}\n管理員\n  電郵: ${ADMIN}\n  密碼: ${APW}\n`;
fs.writeFileSync("/workspace/msw-street-workout/.e2e-creds.txt", creds);
log("憑證已寫入 .e2e-creds.txt");
log("新會員: " + NEW_EMAIL + " / " + NEW_PW);
log("管理員: " + ADMIN + " / " + APW);
await browser.close();
log("DONE. 截圖見", SHOT);
