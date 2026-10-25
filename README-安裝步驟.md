# MSW 街健館官網 — V2 後台系統 安裝步驟（四批擴建 · 正式上線）

| 項目 | 內容 |
| --- | --- |
| 交付日期 | 2026-10-24 |
| base | 本地 git HEAD `2a7ed09`（唯一一筆 commit：「baseline: 616825f」） |
| 改動規模 | **72 項未提交改動** = 43 個修改檔（M）+ 29 個新檔／新目錄（??） |
| 驗收狀態 | 四批全部獨立驗收通過：T-9 ✅／T-14 ✅／T-28 ✅／T-29 ✅（每批 P0 = 0、P1 = 0） |
| 回滾錨點 | `/workspace/MSW-完整備份-20261022-2126.zip`（2026-10-22 全量備份） |
| 核心新文件 | 6 支 Supabase migration（**必跑**，見第二章） |
| 配套文檔 | 《MSW-部署方案》《MSW-上線後實測清單》《MSW-管理員使用手冊》等（見第八章） |

> **一句話**：四批擴建把「改網站内容／SEO／數據分析／草稿預覽／操作紀錄／活動報名」全部搬到後台可視化操作，前台視覺與文案預設值**逐字轉錄現有硬編碼、零改動**（三輪截圖比對把關：10/10、10/10、9/9 一致）；代碼與資料庫**一次性推送**，migration 先行、code 後推。

---

## 一、這包改了什麼

### 1.1 四批總覽

| 批 | 内容 | 對應 migration |
| --- | --- | --- |
| 第一批 | 後台「網站內容」六分區（首頁／選單／頁尾／關於我們等 9 頁文案）、首頁 8 區塊顯隱／排序、前台接線 | `migration-site-content.sql`（播種 5 個 app_settings 鍵） |
| 第二批 | SEO 編輯、圖片上傳引導、一鍵預覽連結、訪客追蹤 beacon、`/admin/analytics` 數據儀表板 | `migration-site-seo.sql`、`migration-analytics.sql`（`page_views` 表 + RLS + 7 支分析 RPC） |
| 第三批 | 操作日誌、草稿預覽 `/preview`、顏色對比度護欄、頁面流量區、站內活動報名 | `migration-audit-log.sql`、`migration-site-draft.sql`、`migration-event-registrations.sql`（表 + 第 8 支 RPC） |
| 第四批 | 培訓物料與模擬演練（《管理員使用手冊》等），**純文檔、無 code、無 migration** | 無 |

### 1.2 最易漏的新檔（untracked，漏咗會編譯失敗或功能壞）

| # | 路徑 | 說明 |
| --- | --- | --- |
| 1 | `supabase/migration-*.sql` × 6 | **必跑**，見第二章；佢哋係 untracked，只存在於呢棵工作樹 |
| 2 | `src/lib/content.ts`（1142 行） | 全站文案型別＋預設值＋護欄，第一批嘅地基 |
| 3 | `src/lib/seo.ts`／`contrast.ts`／`draft.ts`／`audit.ts` | 第二、三批四個新模組 |
| 4 | `src/app/admin/content/`、`admin/analytics/`、`admin/audit-log/` | 三個全新後台頁面 |
| 5 | `src/app/api/admin/site-{content,nav,contact,pages,blocks,seo,draft}/` | 7 個新管理 API |
| 6 | `src/app/api/track/page-view/`、`src/app/api/event-registrations/`、`src/app/api/admin/event-registrations/` | 追蹤與報名 API |
| 7 | `src/app/preview/`、`src/components/tracking/`、`src/components/EventRegisterAction.tsx` | 預覽頁、追蹤 beacon、報名按鈕 |
| 8 | `src/components/motion/`、`src/components/fx/home/HeroParallax.tsx` | **V10 動效層**（2026-10-10 交付），今次一併入庫；已核對與 V10 交付 zip **逐位元組一致**——若你 repo 已套用過 V10，覆蓋屬同內容、無害 |

### 1.3 依賴與環境變數

- **V2 四批零新增依賴**（無需改 `package.json`）。
- 唯一依賴變動來自 V10：`motion` `14.0.0`（已精確鎖定，無 `^`），`pnpm-lock.yaml` 已同步。本地驗證前先 `pnpm install`；Vercel 會自動裝。
- **V2 零新增環境變數**。`.env.example` 僅有 V10 加入的 `NEXT_PUBLIC_MOTION_ENABLED`（動效緊急開關，預設開啟、日常留空即可）。

---

## 二、Supabase migration 執行（DB 先行，6 支全跑）

### 2.1 點解 migration 先、code 後

6 支 migration 全部「**只新增、不改既有表既有欄位既有資料**」。舊版生產 code 根本唔識新表新鍵，先跑 DB 對現有網站**零影響**；反之若 code 先上線，`/admin/analytics`、`/admin/audit-log`、會員端 `/events` 站內報名會即時壞。**先跑 DB 係零風險窗口。**

### 2.2 執行順序（照住呢個順序，全部冪等、重跑無害）

| # | 檔案 | 内容 | 注意 |
| --- | --- | --- | --- |
| 1 | `supabase/migration-site-content.sql` | 播種 5 個鍵：`site_content`／`site_nav`／`site_contact`／`site_pages`／`site_blocks` | 純新增鍵；`on conflict do nothing`，唔會洗你已改過嘅值 |
| 2 | `supabase/migration-site-seo.sql` | 播種 1 個鍵：`site_seo` | 純新增鍵 |
| 3 | `supabase/migration-analytics.sql` | `page_views` 表 + RLS + 索引 + 7 支分析 RPC | 純新增表與函式 |
| 4 | `supabase/migration-audit-log.sql` | `admin_audit_log` 表 + 護欄約束 + RLS | 純新增表 |
| 5 | `supabase/migration-site-draft.sql` | 播種 1 個鍵：`site_content_draft = {}` | 純新增鍵 |
| 6 | `supabase/migration-event-registrations.sql` | `event_registrations` 表 + RLS + 第 8 支 RPC | **必須排喺 3 之後**（檔頭明寫建議順序） |

### 2.3 操作步驟

1. **先備份資料庫**：Supabase 後台 → Database → Backups（或照《備份說明.md》§三）。任何 migration 之前必做。
2. 逐支打開 `/workspace/MSW-官網源碼/supabase/` 下對應檔案，**全選 → SQL Editor → 貼上 → Run**。
3. 每支跑完貼一次檔尾嘅**自檢 SQL**（預期返「1 行」或相應鍵值），逐支自檢語句見《MSW-部署方案》§3.1。
4. 6 支全跑完後，跑一次《部署方案》§3.2 嘅**總自檢**（一次貼住跑）。
5. RLS 沿用 `app_settings` 既有兩條政策自動覆蓋，**不需**手動加政策。

> ⚠️ 6 支彼此無硬相依、各自獨立可跑；唯一軟約束係 3 → 6。全部冪等，萬一中途失敗，修正後重跑嗰支即可。

---

## 三、源碼套用與推送（一次性，一個 commit）

### Step 0　確認 baseline（必做）

```bash
cd /path/to/mswsupabase
git log --oneline -1     # 你嘅 repo 應基於 616825f（V9 + 安全修復後）
git status               # 建議工作區乾淨再套用
```

若你 repo 已套用 V10（檢查 `src/components/motion/` 是否存在），屬預期情況，繼續。

### Step 1　解壓覆蓋

```bash
cd /path/to/mswsupabase
unzip -o /path/to/MSW-V2-安裝包-20261024.zip -d .
git status --short | wc -l    # 預期約 72（若你已有 V10 或其他改动，數目會相應增減）
```

> 本 zip 維持 repo 相對路徑、已排除 `.git`／`.next`／`node_modules`／`.env*`，**唔會**覆蓋你嘅 git 歷史同環境。zip 內 `README-安裝步驟.md`（本檔）**唔使 commit**。

### Step 2　安裝依賴

```bash
pnpm install     # 只需一次；V10 之後已裝過 motion 則佢會話已是最新
```

### Step 3　本地 build 把關（強烈建議）

```bash
pnpm build      # 內含 TypeScript 檢查，必須 0 error
pnpm lint       # 建議一併跑
```

我哋已實測通過（Next.js 16.3.6 生產 build、31/31 靜態頁、eslint 零問題）；若你本地報錯，**唔好 push**，先回報。

### Step 4　一次性 commit 全部

**推送策略：一次性推送全部 72 項，一個 commit。** 理由：唯一經過三重獨立驗收嘅狀態就係而家呢棵整合工作樹；分批 push 要重構出從未存在過、從未測過嘅中間狀態（例如只推第三批碼，`/events` 報名會打唔存在嘅表），係製造風險而非降低風險。詳細論證見《MSW-部署方案》§1.3。

```bash
git add .
git status                 # 再次核對：43 M + 29 ??（或你環境相應數目）
git commit -m "feat: V2 後台系統四批擴建（網站內容六區／SEO／追蹤儀表板／草稿預覽／審計日誌／站內報名）"
```

### Step 5　接 remote 並 push

本地打包環境係單一 commit 快照、從未接過 remote，**預期同 GitHub 現狀不同源**，需人工確認後先至 push：

```bash
git remote -v                                  # 預期空白
git remote add origin https://github.com/mswmacau/mswsupabase.git
git fetch origin
git log --oneline origin/main -3               # 睇對面 main 停喺邊
git log --oneline -1                           # 本地 2a7ed09
```

- 若兩者**不同源**（預期如此）：建議 `git rebase origin/main`（保留 GitHub 歷史），或 `git push --force`（⚠️ 會丟棄對面提交，必須先同負責人確認）。
- 若你未套用過 V10 而 origin/main 已經有 V10 commit：rebase 會自動合併；如有衝突，**只係 V10 檔案重疊，以我方 zip 內容為準**（已核對一致）。

push 完成後 Vercel 會自動部署；狀態轉 **Ready** 先至繼續。

---

## 四、Vercel 部署注意

1. **region 維持 `hkg1`**，本包未修改 `vercel.json`。
2. **無新環境變數要配**（V2 零新增）。
3. ⚠️ **動效開關係 build-time 內聯**（V10 遺留，仍適用）：改 `NEXT_PUBLIC_MOTION_ENABLED` 後**必須 Redeploy**（建議勾選清除 Build Cache），只按 Promote to Production 唔生效。日常留空即可，預設開啟。
4. 部署後即刻做《MSW-部署方案》§4.2 冒煙檢查（約 15 分鐘），通過後轉入第五章實測。

---

## 五、上線後實測（《MSW-上線後實測清單》34 項）

沙箱無 Supabase，凡涉及真實 DB 往來嘅項目標記咗「未實跑」，全部彙成實測清單，**上線後照住跑**：

| 分區 | 項數 | 重點 |
| --- | --- | --- |
| §1 會員端活動報名 E2E | 8 | **最高優先**：報名→重複攔截→取消→後台名單 |
| §2 後台儲存 → 前台 60 秒生效 | — | 回歸確認（改文案→前台見字） |
| §3 草稿 → 預覽 → 發佈全鏈 | 9 | `/preview` 連結、發佈後草稿清空 |
| §4 審計日誌寫入與查看 | 7 | 操作後 `/admin/audit-log` 有紀錄 |
| §5 儀表板數字交叉驗證 | 6 | 同 Supabase 後台直接查數對數 |
| §6 追蹤數據與流量區 | — | 瀏覽量翌日見數、唔記 IP |
| §7 其他第三批項目 | 4 | 對比度護欄等 |

---

## 六、回滾方案（三級，由輕到重）

### L1　功能性回滾（分鐘級，最優先）

- **文案／SEO 改錯**：後台各區「**回復原廠**」掣（網站內容每區、網站設定），一鍵洗返播種預設值；呢啲預設值就係改動前嘅硬編碼文案，洗返等同視覺還原。
- **草稿改錯**：唔使理，草稿只喺 `/preview` 見效，**唔發佈就唔影響前台**。
- **動效異常**（V10 遺留）：`NEXT_PUBLIC_MOTION_ENABLED=false` + Redeploy。

### L2　版本回滾（約 5 分鐘）

Vercel 後台 → Deployments → 上一個 Ready 版本 → **Promote to Production**。（注意：L1 嘅「回復原廠」同 L2 一齊用先至係完全還原。）

### L3　代碼 + DB 回滾（危險區，全部需人工確認）

- 代碼：`git revert <V2 commit>`（或 `git reset --hard` 到上一版，⚠️ 會丟後續改動）→ push，Vercel 自動重新部署。
- DB：**新表／新鍵只新增、未動過既有資料**，多數情況**唔需要行任何 DB 回滾**——舊 code 唔識新表，放喺度無害。若務必清掉（例如報名表有測試數據要洗），SQL 同決策樹見《MSW-部署方案》§5.2／§5.3，**跑之前必須備份 + 同負責人確認**。

> ⚠️ **重要限制**：`/workspace/MSW-完整備份-20261022-2126.zip` 嘅工作樹係 2026-10-22 狀態，**唔包含**四批改動，亦**唔包含** 6 支新 migration（備份時點早於擴建）。6 支新 migration 嘅唯一副本喺現有工作樹同本安裝包入面——**做任何毀滅性操作（reset／洗表）之前，先另行複製留存 `supabase/` 資料夾**。

---

## 七、開放事項（如實呈報，唔收埋）

1. **P2-2 註冊文案矛盾**（負責人決策項）：`site_pages.signup` 兩個鍵——`success_message` 寫「請點驗證連結」、`verify_note` 寫「唔需要收驗證信」——互相矛盾，**兩句都係基線原有文案**（逐字轉錄、非我哋引入）。取決於 Supabase 後台 Confirm email 設定現狀（沙箱判定唔到）。上線後請登入 Supabase → Authentication → Providers → Email 確認；若要改，後台「網站內容 → 註冊頁」自助修改即可，唔使改 code。
2. **沙箱未實跑項**：無 Supabase 憑證，涉及真實 DB 嘅功能全部以「假 Supabase」stub 驅動運行級測試把關，其餘如實列成《上線後實測清單》34 項（見第五章），跑完先至算完全收工。
3. **追蹤端點多實例限制**：`/api/track/page-view` 嘅去重用模組級 Map，**多個 Serverless 實例之間唔共享**（如實標註，上限影響：極短時間重複刷新可能重複計數，唔影響趨勢判斷）。

---

## 八、配套文檔清單

| 文檔 | 用途 | 對象 |
| --- | --- | --- |
| **《MSW-管理員使用手冊》** | 後台管理流程＋步驟教學（11 節、49 個截圖佔位） | **管理員（日常照住做）** |
| 《MSW-管理員FAQ》 | 14 條常見問題 | 管理員 |
| 《MSW-快速上手卡-第一批》 | A4 一頁紙，日常最常用操作 | 管理員（打印貼工位） |
| 《MSW-培訓錄影腳本》 | 5 個場景分鏡，拍培訓片用 | 培訓人員 |
| 《MSW-部署方案》 | 本章嘅完整版：migration 逐支手冊＋自檢 SQL、回滾決策樹、監控告警 | 技術執行人 |
| 《MSW-上線後實測清單》 | 34 項實測，附執行記錄表 | 驗收人 |
| 《MSW-後台系統-分析與計劃-V2》 | 四批計劃原文（T-1～T-29） | 存档 |
| 《MSW-第{一,二,三,四}批驗收報告》 | 每批獨立驗收紀錄 | 存档 |
| 《MSW-完整備份-20261022-2126.zip》 | 擴建前全量備份（回滾錨點） | 存档 |

---

## 九、備註

- 本包未含任何真實環境變數值、金鑰或密碼；`.env.example` 僅含變數名稱與說明。
- `README-安裝步驟.md`（本檔）**唔使 commit**，看完可刪；若不慎 commit 亦無害。
- 《MSW-管理員使用手冊》開頭已如實標註：截圖佔位需在真實後台補拍（沙箱無 Supabase 登入狀態）。
