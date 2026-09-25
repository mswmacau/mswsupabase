# SPEC-R6 — MSW 街健館 R6 需求：介面契約 + 任務清單與驗收標準

> 版本：v1.0｜撰寫：任析（product-architect）
> 對象：白客（後端）、方砚（前端）、PM
> 本文件是 **前後端共同遵守的唯一契約**。API 路徑、欄位名、HTTP status、錯誤字串、檔案歸屬皆以本文為準，實作時不得自行改名或增減欄位。有疑義先改本文，再改程式。

---

## 0. 範圍與共通協定

### 0.1 本次範圍

| 代號 | 需求 | 本文件處理方式 |
|---|---|---|
| A | 活動管理模組（含封面圖片）+ 前台 `/events` 讀 DB + 後台導航 | 完整資料模型 / API 契約 / 前端契約 |
| B | 後台網站設定（Logo、Hero、名稱標語、品牌色、字型、排版密度）+ 全域套用 + 指南章節定義 | 完整資料模型 / API 契約 / 前端契約 / CSS 變數表 |
| C | 效能：8 秒卡頓、無 loading 畫面 | 逐頁 `force-dynamic` 去留、`loading.tsx` 清單、DB 平行化清單、Vercel 區域評估 |
| D | 跑步截圖上傳顯示「網路錯誤」 | 根因判定 + 改造契約（`POST /api/runs` 改 JSON） |
| E | 安全性複驗 | 僅列任務與驗收標準 |
| F | 訪客 / 管理員 agent 雙重驗證 | 僅列任務與驗收標準 |

### 0.2 本版本**不包含**（明確排除，禁止偷渡）

1. 活動的**線上報名流程與報名名單**（本版只存「報名連結」或「報名方式文字」）。
2. 活動的**硬刪除（purge）** UI（本版刪除＝軟刪除 `status='archived'`，硬刪除只能在 Supabase 後台手動執行）。
3. 主題的**多套版型（theme preset 切換整套）**、深色/淺色模式切換。
4. **自訂網頁字體檔案上傳**與 Google Fonts 動態載入（字型只從 4 組內建字體堆疊中選）。
5. 活動封面的**裁切/濾鏡編輯器**（只做上傳 + 預覽 + 更換）。
6. **i18n / 英文版前台**。
7. 任何形式的 **Server Actions**（見 0.3）。

### 0.3 硬性約束（不可違反，違者一律退件）

| # | 約束 | 落地方式 |
|---|---|---|
| H1 | **禁止 Server Actions**。WAF（EdgeOne/stgw）會 403 攔截帶 `next-action` header 的 POST。 | 所有寫入一律 Route Handler + 前端 `fetch`。`src/app/actions/` 不得重建。`next.config.ts` 中的 `experimental.serverActions` 必須刪除（見 BE-17）。lint 驗收：`grep -r "use server" src` 結果必須為空。 |
| H2 | Vercel Hobby request body 上限 **4.5MB**，超限回傳**非 JSON 的 413 HTML**。 | 所有圖片採「瀏覽器 canvas 壓縮 → **瀏覽器直傳 Supabase Storage** → 只把 `path` 以 JSON 送 API」。詳見 §3.2 決策說明。任何檔案位元組不得經過 Route Handler。 |
| H3 | 前端表單維持 `useRef/useState + fetch` | 不得導入 `useActionState` / `react-hook-form` 等新套件。 |
| H4 | 所有 DB 寫入受 RLS 保護，且 **API Route 內必須自行再做一次權限檢查** | 每支 admin API 開頭依序：`isSupabaseConfigured → requireAdmin()`。前端隱藏按鈕不算防護。 |
| H5 | Supabase 免費版 | 不新增付費功能（無 Read Replica、無 PITR、無 Supabase Edge Functions）。`app_settings` 已有 `setting_num()` 可讀數值設定。 |
| H6 | 所有 Route Handler **任何情況都必須回傳 JSON** | 全體包 try/catch，禁止讓例外裸奔成 HTML 錯誤頁（這是 D 需求的幫兇）。 |

### 0.4 統一 API 回應格式

```ts
// src/lib/api.ts（新增，owner：白客；前端只讀不用 import）
export type ApiErrorCode =
  | "SUPABASE_NOT_CONFIGURED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "STORAGE"
  | "INTERNAL";

// 成功：一律帶 ok:true，其餘攤平在同一層
export type ApiOk = { ok: true } & Record<string, unknown>;

// 失敗：一律帶 ok:false，error 為**要直接顯示給終端客戶看的繁中句子**
export type ApiErr = {
  ok: false;
  error: string;
  code?: ApiErrorCode;
  fields?: Record<string, string>; // 欄位級錯誤，key 用 §2 定義的欄位名
};
```

共通錯誤對照（所有 admin API 一致）：

| 情境 | HTTP | code | error 文案（一字不改） |
|---|---|---|---|
| 未設定 Supabase env | 400 | `SUPABASE_NOT_CONFIGURED` | `尚未連接 Supabase。` |
| 未登入 | 401 | `UNAUTHENTICATED` | `登入逾期，請重新登入。` |
| 已登入但非管理員 | 403 | `FORBIDDEN` | `權限不足。` |
| JSON 解析失敗 | 400 | `VALIDATION` | `資料格式錯誤。` |
| 欄位驗證失敗 | 400 | `VALIDATION` | `請檢查表單內容。` + `fields` |
| 找不到資源 | 404 | `NOT_FOUND` | `找不到這筆資料。` |
| 狀態衝突 | 409 | `CONFLICT` | 見各支 API |
| Storage 操作失敗 | 502 | `STORAGE` | `圖片處理失敗，請重新上傳圖片。` |
| 未預期例外 | 500 | `INTERNAL` | `伺服器錯誤，請稍後再試。` |

> **前端共通處理**：`res.ok === true` 才 `res.json()`；先檢查 `content-type` 是否含 `application/json`，否則顯示 `伺服器回應異常（HTTP {status}），請稍後再試。`（詳見 FE-14）。

### 0.5 術語

- **呼叫者**：瀏覽器。
- **公開素材網址**：`https://{SUPABASE_PROJECT_HOST}/storage/v1/object/public/site-assets/{path}`（即 `NEXT_PUBLIC_SUPABASE_URL` 指到的 host），由 `src/lib/assets.ts` 的 `publicAssetUrl(path)` 產生，任何地方都不許手寫這串網址。
- **`todayISO()`**：以 `Asia/Macau` 時區計算的 `YYYY-MM-DD`（新增於 `src/lib/utils.ts`，owner 白客）。不可用 `new Date().toISOString().slice(0,10)`（UTC 會在澳門晚間造成差一天）。

---

## 1. 資料模型

### 1.1 新增檔案：`supabase/schema-r6.sql`（可重複執行）

owner：白客。執行方式：Supabase 後台 SQL Editor 整段貼上執行；同時在 `supabase/schema.sql` 第 1 行註解後補一行：
`-- R6 追加結構請見同目錄 schema-r6.sql（events / site_theme / site-assets）`

```sql
-- =============================================================
-- MSW R6：活動管理 + 網站主題 + 公開素材 bucket
-- 可重複執行（idempotent）
-- =============================================================

-- ------------------------------------------------------------
-- 1. events — 後台可管理的活動（含封面圖片）
-- ------------------------------------------------------------
create table if not exists public.events (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (length(title) between 1 and 120),
  subtitle           text check (subtitle is null or length(subtitle) <= 200),
  body               text check (body is null or length(body) <= 5000),
  event_date         date not null,
  end_date           date,
  start_time         text check (start_time is null or length(start_time) <= 20),
  end_time           text check (end_time is null or length(end_time) <= 20),
  location           text check (location is null or length(location) <= 120),
  capacity           integer check (capacity is null or capacity between 1 and 99999),
  registration_url   text check (registration_url is null or length(registration_url) <= 500),
  registration_note  text check (registration_note is null or length(registration_note) <= 300),
  cover_path         text check (cover_path is null
                       or cover_path ~ '^events/[A-Za-z0-9][A-Za-z0-9/_.-]*\.(jpg|jpeg|png|webp)$'),
  status             text not null default 'draft'
                       check (status in ('draft', 'published', 'archived')),
  sort_order         integer not null default 0,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint events_end_date_check check (end_date is null or end_date >= event_date)
);

create index if not exists idx_events_published
  on public.events (event_date, sort_order desc, id)
  where status = 'published';

create index if not exists idx_events_admin
  on public.events (created_at desc);

-- updated_at 自動維護
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
  before update on public.events
  for each row execute function public.touch_updated_at();

alter table public.events enable row level security;

grant select                         on public.events to anon, authenticated;
grant insert, update, delete         on public.events to authenticated;

drop policy if exists "events_select_published_or_admin" on public.events;
create policy "events_select_published_or_admin" on public.events
  for select using (status = 'published' or public.is_admin());

drop policy if exists "events_admin_all" on public.events;
create policy "events_admin_all" on public.events
  for all using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------
-- 2. app_settings：網站主題（單列 key='site_theme'，JSONB）
--    取捨見 §1.5
-- ------------------------------------------------------------
insert into public.app_settings (key, value)
values (
  'site_theme',
  '{
     "brand_name": "MSW 街健館",
     "brand_name_en": "Macau Street Workout",
     "tagline_zh": "用自身的重量，練出澳門最強的街頭力量",
     "tagline_en": "",
     "logo_path": null,
     "hero_bg_path": null,
     "color_ink": "#0F0F0F",
     "color_ink_soft": "#161616",
     "color_ink_line": "#262626",
     "color_paper": "#F5F5F7",
     "color_cobalt": "#0047AB",
     "color_cobalt_bright": "#0057FF",
     "color_vital": "#E3001B",
     "color_vital_bright": "#FF2D2D",
     "color_white": "#FFFFFF",
     "font_preset": "classic",
     "font_stack_custom": null,
     "radius_card": 16,
     "radius_btn": 9999,
     "radius_field": 12,
     "container_max": 1200,
     "space_section": 80,
     "hero_overlay_opacity": 0.55
   }'::jsonb
)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 3. monthly_leaderboard：把「月度統計 + 排行榜暱稱」合成一次查詢
--    （原本 getMonthlyLeaderboard 要 2 次來回，見 §4.4）
--    security_invoker = false → 匿名訪客可讀（與既有 public_leaderboard 一致）
-- ------------------------------------------------------------
drop view if exists public.monthly_leaderboard cascade;
create view public.monthly_leaderboard
with (security_invoker = false) as
select
  s.user_id,
  s.period_month,
  s.total_km,
  s.runs,
  p.display_name,
  p.avatar_url,
  p.points
from public.monthly_running_stats s
join public.public_leaderboard p on p.id = s.user_id;

grant select on public.monthly_leaderboard to anon, authenticated;

-- ------------------------------------------------------------
-- 4. Storage：site-assets（公開讀取 bucket）
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('site-assets', 'site-assets', true)
on conflict (id) do nothing;

-- 若 bucket 已存在卻是私有，強制改為公開（幂等）
update storage.buckets
   set public = true
 where id = 'site-assets' and public is not true;

drop policy if exists "siteassets_select_public" on storage.objects;
create policy "siteassets_select_public" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'site-assets');

drop policy if exists "siteassets_admin_all" on storage.objects;
create policy "siteassets_admin_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'site-assets' and public.is_admin())
  with check (bucket_id = 'site-assets' and public.is_admin());
```

### 1.2 `events` 欄位語意（寫入端必須遵守）

| 欄位 | 型別 | 必填 | 預設 | 語意 / 約束 |
|---|---|---|---|---|
| `id` | uuid | auto | `gen_random_uuid()` | 前端不得自帶 |
| `title` | text | ✔ | — | 1–120 字，活動標題（卡片大標） |
| `subtitle` | text | ✖ | `null` | ≤200 字，副標（卡片小標／hover 文案） |
| `body` | text | ✖ | `null` | ≤5000 字，內文純文字；換行以 `\n` 存，前端用 `whitespace-pre-line` 呈現 |
| `event_date` | date | ✔ | — | `YYYY-MM-DD`。活動開始日（單日活動即活動日） |
| `end_date` | date | ✖ | `null` | 多日活動填；`null` = 單日；必須 ≥ `event_date`（DB constraint） |
| `start_time` | text | ✖ | `null` | ≤20 字，自由文字（例如 `19:30`／`19:30 集合`） |
| `end_time` | text | ✖ | `null` | ≤20 字 |
| `location` | text | ✖ | `null` | ≤120 字 |
| `capacity` | integer | ✖ | `null` | 1–99999；`null` = 不限名額 |
| `registration_url` | text | ✖ | `null` | ≤500 字；只允許 `https://` / `http://` / `mailto:` / `tel:` 開頭 |
| `registration_note` | text | ✖ | `null` | ≤300 字，報名方式文字說明（沒有連結時必填，見 §2 API 邏輯） |
| `cover_path` | text | ✖ | `null` | Storage 物件路徑，必須符合 `^events/...\.(jpg\|jpeg\|png\|webp)$` |
| `status` | text | ✔ | `draft` | `draft`（未上架）／`published`（上架）／`archived`（已下架軟刪除） |
| `sort_order` | integer | ✔ | `0` | 數字小者在前（預設 0，與 `event_date` 共同排序，見 §2 `getPublishedEvents`） |
| `created_by` | uuid | auto | `null` | 由 API 帶入管理者 uid（前端不得提供） |
| `created_at` / `updated_at` | timestamptz | auto | `now()` | `updated_at` 由 trigger 維護 |

> **`status` 三態語意（重要）**：`draft` 與 `archived` 都**不會**出現在前台；差別在於 `archived` 也不出現在後台預設列表（需切「已下架」篩選器才能看到並復原）。**本版不提供硬刪除 UI。**

### 1.3 `app_settings.site_theme` JSONB 結構（`SiteTheme`）

```ts
// src/lib/theme.ts（新增，owner：白客）
export type FontPreset = "classic" | "system" | "serif" | "custom";

export interface SiteTheme {
  brand_name: string;            // 1–60
  brand_name_en: string;         // 1–80
  tagline_zh: string | null;     // ≤120，null = 空
  tagline_en: string | null;     // ≤160，null = 空
  logo_path: string | null;      // ^logo/...(jpg|jpeg|png|webp)$，null = 用文字 LOGO
  hero_bg_path: string | null;   // ^hero/...(jpg|jpeg|png|webp)$，null = 用漸層預設背景
  color_ink: string;             // #RRGGBB
  color_ink_soft: string;
  color_ink_line: string;
  color_paper: string;
  color_cobalt: string;
  color_cobalt_bright: string;
  color_vital: string;
  color_vital_bright: string;
  color_white: string;
  font_preset: FontPreset;
  font_stack_custom: string | null; // 僅 font_preset==='custom' 時有效，≤300，見 §2 白名單
  radius_card: number;           // 0–32 px
  radius_btn: number;            // 0–9999 px（9999 = 全圓膠囊，現況預設）
  radius_field: number;          // 0–24 px
  container_max: number;         // 960–1440 px
  space_section: number;         // 48–160 px，套用在 `.section-pad`
  hero_overlay_opacity: number;  // 0–0.9，Hero 背景遮罩（避免白字壓在亮圖上看不清）
}
```

### 1.4 Storage 物件路徑規則

| bucket | 公開 | 用途 | 路徑格式 | 寫入者權限 |
|---|---|---|---|---|
| `run-screenshots`（既有） | 私有 | 跑步截圖 | `{uid}/{ts}-{rand}.{ext}` | 會員本人（既有 policy） |
| `site-assets`（新增） | **公開** | 活動封面 / Logo / Hero | `events/{yyyy}{mm}/{ts}-{rand}.{ext}`、`logo/{ts}-{rand}.{ext}`、`hero/{ts}-{rand}.{ext}` | 僅 `is_admin()` |

硬規則：
1. **永不覆寫同名物件**（`upsert: false`，檔名一律含 `Date.now()` + 6 位亂數），避免 CDN 快取住舊圖。
2. 允許副檔名：`jpg` / `jpeg` / `png` / `webp`。
3. 更換封面/Logo/Hero 後，**由 Route Handler 在 DB 寫入成功後**刪除舊物件（best-effort，失敗只 `console.warn`，不回傳錯誤給使用者）。

### 1.5 關鍵取捨與理由

| 決策點 | 選擇 | 理由 |
|---|---|---|
| 主題要存 `app_settings` 還是新表 `site_theme`？ | **存 `app_settings`，單列 `key='site_theme'`、value 為一個 JSONB 物件** | ① `app_settings` 已啟用 RLS，且已存在 `settings_select_all`（含 anon 可讀）與 `settings_admin_write`（管理員可寫）兩條 policy，正好滿足「前台匿名也要讀到主題 + 後台可寫」，**零新表、零新 policy、零新 migration 風險**；② 整站主題是一次性整包寫入/整包讀取，**不需要欄位級查詢**，單列 JSONB 讓 root layout 只需 1 次來回；③ 缺點是沒有欄位級約束 → 由 `src/lib/theme.ts` 的 `normalizeTheme()` 做白名單 + 型別 + 範圍驗證補齊，且該函式同時被 Route Handler 與 root layout 使用，驗證邏輯只有一份。 |
| 圖片上傳要「壓縮後送 API」還是「瀏覽器直傳」？ | **瀏覽器 canvas 壓縮 + 瀏覽器直傳 Supabase Storage，只把 `path` 以 JSON 送 API** | 見 §3.2，理由有四點，其中最關鍵的是：檔案位元組**完全不經過 Vercel**，因此與 4.5MB 上限徹底脫鉤，且失敗訊息是 Supabase 的結構化 JSON（可顯示真實原因），不會再出現不可診斷的「網路錯誤」。 |
| 主題注入要 `<style>:root{}` 還是 inline style？ | **`<html style={vars}>`（React 19 支援 CSS custom properties）＋ globals.css 內寫死的 token 消費規則** | ① 完全不需要用使用者輸入組 CSS 字串，**根除 CSS injection**（`font_stack_custom` 是唯一自由存取的字串，經 React 屬性轉義）；② inline style 權重高於樣式表，必定蓋掉 Tailwind v4 `@theme` 定義的同名變數；③ 現有 Tailwind utilities（`bg-ink`、`text-vital` 等）會自動跟著變，不必改任何 JSX class。 |
| 「排版密度」要下拉三選一還是數值？ | **拆成三個明確數值欄位**（`container_max` / `radius_card` / `space_section`） | 若同時有 `density` 下拉與數值欄位，會出現兩個來源爭奪同一個 CSS 變數，行為不可預測。拆成數值後單一來源、單一驗證規則。 |
| 活動刪除是硬刪還是軟刪？ | **軟刪除（`status='archived'`）** | 這是終端客戶的正式網站，誤刪活動＝永久損失且無法復原（Storage 圖還會變孤兒）。軟刪除可一鍵復原，成本極低。 |

---

## 2. API 契約

### 2.0 總表

| # | Method | 路徑 | 用途 | 權限 | 檔案（都位於 `src/app/`） |
|---|---|---|---|---|---|
| 1 | `GET` | `/api/health` | Health check / keep-alive | 公開 | `api/health/route.ts`（新增） |
| 2 | `POST` | `/api/admin/events` | 新增活動 | admin | `api/admin/events/route.ts`（新增） |
| 3 | `PATCH` | `/api/admin/events` | 編輯活動（含上下架） | admin | 同上 |
| 4 | `DELETE` | `/api/admin/events` | 軟刪除活動 | admin | 同上 |
| 5 | `POST` | `/api/admin/site-settings` | 儲存網站主題 | admin | `api/admin/site-settings/route.ts`（新增） |
| 6 | `DELETE` | `/api/admin/site-settings` | 重設為原廠主題 | admin | 同上 |
| 7 | `POST` | `/api/runs` | **改造**：改收 JSON（圖片已直傳） | 會員本人 | `api/runs/route.ts`（既有，改寫） |
| — | `DELETE` | `/api/runs` | 維持原邏輯不變 | 會員本人 | 既有 |
| 8 | `GET` | `/api/me` | **P1 待 PM 拍板才開工**，會員狀態 client island | 公開 | `api/me/route.ts` |

### 2.1 共用權限前置邏輯（每支 admin API 都要一字不漏照做）

```ts
// 1) env 檢查
if (!isSupabaseConfigured)
  return NextResponse.json({ ok:false, code:"SUPABASE_NOT_CONFIGURED", error:"尚未連接 Supabase。" }, { status:400 });

// 2) 管理者檢查（requireAdmin() 來自 src/lib/supabase/server.ts，內部走 profiles.role）
const admin = await requireAdmin();
if (!admin)
  return NextResponse.json({ ok:false, code:"UNAUTHENTICATED", error:"登入逾期，請重新登入。" }, { status:401 });
```

> 說明：`requireAdmin()` 未區分「未登入」與「非管理員」；**新 API 一律比照既有 `/api/admin/*` 寫法**，未登入回 401 `登入逾期，請重新登入。`、已登入非管理員回 403 `權限不足。`（判斷方式：先 `getCurrentUser()` 取 user 判 401，再 `requireAdmin()` 判 403）。

### 2.2 `GET /api/health`

- 權限：無。Body：無。不可查 DB（避免 Supabase 暫停時 health check 本身也變慢）。

```ts
// Response 200
{ "ok": true, "ts": 1770000000000 }
```

### 2.3 `POST /api/admin/events` — 新增活動

**Request**：`Content-Type: application/json`

```ts
type CreateEventRequest = {
  title: string;                 // 必填 1–120
  subtitle?: string | null;      // ≤200
  body?: string | null;          // ≤5000
  event_date: string;            // 必填 YYYY-MM-DD
  end_date?: string | null;
  start_time?: string | null;    // ≤20
  end_time?: string | null;      // ≤20
  location?: string | null;      // ≤120
  capacity?: number | null;      // 1–99999
  registration_url?: string | null;
  registration_note?: string | null;
  cover_path?: string | null;    // 必須已上傳到 site-assets/events/**
  status?: "draft" | "published"; // 預設 "draft"；不接受 "archived"
};
```

**驗證順序（先到先回，同一支 handler 依序檢查）**

| 順序 | 檢查 | 失敗回應 |
|---|---|---|
| 1 | `title` 去空白後長度 1–120 | 400 `VALIDATION`，`fields.title = "請填寫活動標題（1–120 字）。"` |
| 2 | `event_date` 符合 `/^\d{4}-\d{2}-\d{2}$/` 且為有效日期 | 400，`fields.event_date = "請選擇正確的活動日期。"` |
| 3 | `end_date`（有值時）格式正確且 ≥ `event_date` | 400，`fields.end_date = "結束日期不可早於活動日期。"` |
| 4 | `start_time` / `end_time` ≤ 20 字 | 400，`fields.start_time = "時間請填 20 字以內，例如 19:30。"` |
| 5 | `location` ≤120、`registration_note` ≤300、`subtitle` ≤200、`body` ≤5000 | 400，各自 `fields.*` |
| 6 | `capacity` 為整數且 1–99999（有值時） | 400，`fields.capacity = "名額請填 1–99999 的整數。"` |
| 7 | `registration_url` 空白或以 `https://` / `http://` / `mailto:` / `tel:` 開頭（**含 `javascript:` 一律拒絕**） | 400，`fields.registration_url = "報名連結請用 https://、mailto: 或 tel: 開頭。"` |
| 8 | **`registration_url` 與 `registration_note` 至少一個有值** | 400，`fields.registration_note = "請填寫報名連結或報名方式（至少一種）。"` |
| 9 | `cover_path` 符合 `^events/[A-Za-z0-9][A-Za-z0-9/_.-]*\.(jpg\|jpeg\|png\|webp)$` | 400，`fields.cover_path = "封面圖片格式錯誤，請重新上傳。"` |
| 10 | **Storage 存在性檢查**：對 `cover_path` 的資料夾做 `supabase.storage.from('site-assets').list(dir, { search: base, limit: 1 })`，`data` 為空或無相符項目 | 400 `VALIDATION`，`fields.cover_path = "封面圖片不存在，請重新上傳。"` |
| 11 | `status` ∈ `draft` / `published`（有值時） | 400，`fields.status = "上下架狀態錯誤。"` |

**寫入**：`supabase.from('events').insert({ ..., created_by: admin.id }).select().single()`

**Response**

```ts
// 201 Created
{ ok: true, data: Event, message: "已建立活動「{title}」。" }
```

其他失敗：`401` / `403` 照 §0.4；DB 寫入錯誤 → `500 INTERNAL`。

**revalidate**：`revalidatePath("/events")`、`revalidatePath("/admin/events")`、`revalidatePath("/")`

### 2.4 `PATCH /api/admin/events` — 編輯活動（含上下架）

同一支 handler 支援兩種 body，以 `statusOnly` 布林分支：

**(a) 完整更新**

```ts
type UpdateEventRequest = { id: string } & Partial<CreateEventRequest> & { status?: "draft" | "published" | "archived" };
```

- `id` 缺失或非 uuid → 400 `VALIDATION` `找不到這筆活動。`
- 先 SELECT 該列（`.eq('id', id).maybeSingle()`）查不到 → 404 `NOT_FOUND` `找不到這筆活動。`
- 欄位驗證規則與 §2.3 完全相同，但改為「有提供的欄位才驗證」（`title` 若提供空白 → 400）
- **`registration_url` / `registration_note` 的「至少一個有值」檢查**：以「更新後的結果」判定
- **`cover_path` 處理**：
  - 提供且與舊值不同 → 先做 §2.3 第 9–10 步的存在性檢查（失敗即中止，不寫 DB）
  - DB UPDATE **成功後**，若舊 `cover_path` 存在且以 `events/` 開頭且與新值不同 → `supabase.storage.from('site-assets').remove([old])`，失敗只 `console.warn`
  - 提供 `cover_path: null` 代表移除封面 → DB 寫入後同樣刪除舊物件（必輸 Confirm：前端必須彈出「確認移除封面？」對話框，`removeCover: true` 必須同時帶入）
- `status` 允許 `archived`（= 下架）；`archived → published` 視為復原，允許

**(b) 只改上下架/復原（前端列表上的「上架 / 下架 / 復原」按鈕）**

```ts
type ToggleEventRequest = { id: string; status: "draft" | "published" | "archived"; statusOnly: true };
```

- 只 UPDATE `status` 與 `updated_at`（trigger 自動）
- 查不到 → 404

**Response**：`200 { ok:true, data: Event, message: "已更新活動「{title}」。" }` / toggle 成功回 `message: "已上架。"` / `"已下架。"` / `"已復原。"`（依目標 status：`published`→已上架，`draft`→已下架，`archived`→已下架）

### 2.5 `DELETE /api/admin/events` — 軟刪除

```ts
type DeleteEventRequest = { id: string; confirm: true };
```

| 情境 | HTTP | 回應 |
|---|---|---|
| 缺 `id` | 400 | `VALIDATION` `找不到這筆活動。` |
| 缺 `confirm: true` | 400 | `VALIDATION` `請先勾選「確認下架此活動」再執行。` |
| 查不到 / 已是 `archived` | 404 / 409 | `找不到這筆活動。` / `CONFLICT` `此活動已下架。` |
| 成功 | 200 | `{ ok:true, message:"活動已下架，可在「已下架」清單復原。" }` |

- 只做 `UPDATE events SET status='archived'`，**不刪 Storage 物件**（復原後封面要能用）。
- revalidate：`/events`、`/admin/events`、`/`

### 2.6 `POST /api/admin/site-settings` — 儲存網站主題

**Request**：`Partial<SiteTheme>` 形式的 JSON（**整包送出**，前端每次都送全部 22 個欄位）

| 欄位 | 驗證規則（不符一律 400 `VALIDATION` + `fields.<欄位名>`） |
|---|---|
| `brand_name` | 去空白後 1–60 字 |
| `brand_name_en` | 去空白後 1–80 字 |
| `tagline_zh` | `null` 或 ≤120 字 |
| `tagline_en` | `null` 或 ≤160 字 |
| `logo_path` | `null` 或 `^logo/[A-Za-z0-9][A-Za-z0-9/_-]*\.(jpg\|jpeg\|png\|webp)$` + Storage 存在性檢查 |
| `hero_bg_path` | `null` 或 `^hero/…同一規則$` + Storage 存在性檢查 |
| 9 個 `color_*` | `/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/`，不符時統一轉成大寫 6 碼後存 |
| `font_preset` | ∈ `classic` \| `system` \| `serif` \| `custom` |
| `font_stack_custom` | `font_preset !== 'custom'` 時強制寫 `null`；= `'custom'` 時必填、**長度 1–300**、且**只允許** `[A-Za-z0-9 ,\-_."']`（含 `;` `{}` `<>` `/` `` ` `` `\` `:` `@` 一律 400）；不符 → `fields.font_stack_custom = "字體名稱只可填英文、數字、空白與逗號。"` |
| `radius_card` | 整數 0–32 |
| `radius_btn` | 整數 0–9999 |
| `radius_field` | 整數 0–24 |
| `container_max` | 整數 960–1440 |
| `space_section` | 整數 48–160 |
| `hero_overlay_opacity` | 數字 0–0.9（兩位小數內） |

**處理流程**
1. 先算 `next = normalizeTheme(input, DEFAULT_THEME)`（缺欄位補預設、型別修正）。
2. Storage 存在性檢查：`logo_path` / `hero_bg_path`（任一不存在 → 400 `fields.<欄位> = "圖片不存在，請重新上傳。"`）。
3. **先讀舊值**（`SELECT value FROM app_settings WHERE key='site_theme'`）。
4. UPSERT：`insert({key:'site_theme', value: next, updated_at: new Date().toISOString()}) onConflict('key') do update`。
5. **DB 成功後**清理舊圖：舊 `logo_path` / `hero_bg_path` 若與新值不同且不為 null → `remove([...])`（best-effort，`console.warn`）。
6. `revalidateTag("site-theme")` + `revalidatePath("/", "layout")`。

**Response**：`200 { ok:true, data: SiteTheme, message:"網站設定已儲存，重新載入頁面後生效。" }`

> **快取時效**：前台主題以 60 秒為單位快取（§4.4），因此管理員按儲存後，自己 `router.refresh()` 會立即生效；其他訪客最遲 60 秒後看到新設定，此行為需在 UI 上以註解文字告知。

### 2.7 `DELETE /api/admin/site-settings` — 回復原廠

- 無 body。行為：寫回 `DEFAULT_THEME` 的整包值（**不動 `logo_path` 以外的任何資料表**，也不刪 Storage 物件）。
- Response：`200 { ok:true, data: SiteTheme, message:"已回復原廠設定。" }`
- revalidate：同 §2.6 第 6 步。
- 前端必須用 `window.confirm("確定要回復原廠設定嗎？這會清除你在網站設定頁做的所有調整。")` 二次確認。

### 2.8 `POST /api/runs`（改造）— 跑步紀錄提交

> **需求 D 的根因判定**：`/api/runs` 目前收 `FormData`，代表**整張圖片會穿過 Vercel Function**。Vercel Hobby request body 上限 4.5MB，超限時平台在 Function 之前就回 HTML 413，**handler 完全沒執行**；前端 `await res.json()` 解析 HTML 拋錯，落到 `RunUploadForm.tsx` 的 `catch` 顯示「網路錯誤，請稍後再試。」。次要成因：`RULES.MAX_UPLOAD_MB = 8` 的前端檔的限制大於平台的 4.5MB，所以 5–8MB 的圖必然失敗。
> **改造方向**：與活動封面完全一致 —— 瀏覽器壓縮後直傳 `run-screenshots`，只把 `path` 以 JSON 送來。

**Request**：`Content-Type: application/json`

```ts
type CreateRunRequest = {
  km: number;             // 必填，>0 且 ≤ RULES.MAX_KM_PER_SUBMISSION(200)
  period_month: string;   // 必填 YYYY-MM-DD?? 不，是 'YYYY-MM'
  image_path: string;     // 必填，必須符合 ^{uid}/ 開頭
  note?: string | null;   // ≤200
};
```

| 檢查 | 失敗回應 |
|---|---|
| `km` 不是數字 / ≤0 / >200 | 400 `VALIDATION` `請填寫有效的公里數（0.01–200）。` |
| `period_month` 不符 `/^\d{4}-\d{2}$/` | 400 `月份格式錯誤。` |
| `image_path` 為空、不以 `${user.id}/` 開頭、或不符 `/^[\w./-]+\.(jpg\|jpeg\|png\|webp\|heic)$/i` | 400 `VALIDATION` `請重新上傳跑步截圖。` |
| **Storage 存在性檢查**（`list(dir,{search:base})` 找不到） | 400 `VALIDATION` `截圖上傳失敗，請重新上傳後再提交。` |
| 成功 | 200 `{ ok:true, message:"已提交 {km} 公里，等待後台確認。" }` |

- INSERT 失敗 → 500 `INTERNAL`；revalidate 維持 `/run`、`/dashboard`、`/leaderboard`。
- **不再有任何 `multipart/form-data` 處理**。既有 `MAX_UPLOAD_MB` 常數改名為 `MAX_UPLOAD_SOURCE_MB = 12`（原檔上限，僅瀏覽器端提示用），`MAX_UPLOAD_BYTES = 1_200_000`（壓縮後上限）。

### 2.9 `GET /api/me`（P1，待 PM 拍板）

```ts
// Response 200（永遠 200，未登入回 null 值，不回 401）
{ ok: true, isLoggedIn: boolean, displayName: string | null, points: number, isAdmin: boolean }
```
用途：把 root layout / Nav / Footer 的會員狀態客戶端化，換取 layout 靜態化（見 §4.3）。**未拍板前不要開工。**

---

## 3. 前端契約

### 3.1 檔案清單、職責、API 對應

#### 新增（全部 owner：方砚）

| 檔案 | 職責 | 對應 API / 查詢 |
|---|---|---|
| `src/lib/image-compress.ts` | `compressImage(file, opts)`：canvas 壓縮（長邊 ≤1600、品質 0.82），含 HEIC 明確報錯與降品質重試 | 無 |
| `src/lib/assets.ts` | `publicAssetUrl(path)`、`ASSET_PREFIX`（`events/`、`logo/`、`hero/`） | 無 |
| `src/lib/upload.ts` | `uploadImageFile(file, kind)`：壓縮 → 直傳 → 回傳 `path`；統一 Storage 錯誤中文化 | Supabase Storage（瀏覽器 JWT） |
| `src/lib/fetch-json.ts` | `postJson<T>(url, body)`：統一 JSON 請求與非 JSON 回應處理 | 全部 `/api/**` |
| `src/components/NavProgress.tsx` | 全域導航進度條（2px 頂部 `bg-vital-bright`），見 §3.5 演算法規格 | 無 |
| `src/components/Skeleton.tsx` | `CardSkeleton` / `GridSkeleton` / `ListSkeleton` / `TableSkeleton`（`animate-pulse`） | 無 |
| `src/components/AssetUploader.tsx` | 共用圖片上傳 + 預覽 + 更換 + 移除（props 見下表） | Storage 直傳 |
| `src/app/admin/events/page.tsx` | Server Component：讀 `getAdminEvents()`，渲染 `<EventManager>` | `getAdminEvents()` |
| `src/app/admin/events/EventManager.tsx` | Client：列表 + 新增/編輯表單 + 上架/下架/復原/下架確認 + 已下架篩選 | `POST`/`PATCH`/`DELETE /api/admin/events` |
| `src/app/admin/site-settings/page.tsx` | Server Component：讀 `getSiteTheme()` + `<SetupCard>` 外殼 | `getSiteTheme()` |
| `src/app/admin/site-settings/SettingsForm.tsx` | Client：22 個欄位表單（色票 chips + `<input type="color">`、字體 radio、三個數值 slider with 數字輸入框、Logo/Hero 上傳） | `POST`/`DELETE /api/admin/site-settings` |
| `src/components/EventCard.tsx` | 前台活動卡（封面 16:9、日期徽章、地點、名額、報名按鈕） | 無 |
| `loading.tsx` × 16 | 見 §4.3 清單 | 無 |

`AssetUploader` props（前後端共用契約）：

```ts
interface AssetUploaderProps {
  kind: "event" | "logo" | "hero" | "run";  // 決定 bucket 與 path 前綴
  value: string | null;                      // 目前 path
  onChange: (path: string | null) => void;   // 上傳成功後回傳新 path
  disabled?: boolean;
  aspect?: "16/9" | "2/1" | "1/1" | "auto";  // 預覽框比例（event → 16/9，logo → 1/1，hero → 2/1）
  hint?: string;                             // 「建議尺寸 1600×900 以上，長邊超過 1600px 會自動壓縮」
}
```

#### 修改

| 檔案 | 修改內容 | owner |
|---|---|---|
| `src/app/layout.tsx` | 讀 `getSiteTheme()` → `<html style={themeCssVars(theme)}>`、`<body>`、`props` 傳給 Nav/Footer、掛 `<NavProgress />` | 方砚 |
| `src/app/globals.css` | 所有硬寫值改為 CSS 變數（唯一真源，見 §3.4）；新增 `.section-pad` | 方砚 |
| `src/components/Nav.tsx` | 新增 props：`logoUrl`、`brandName`、`brandNameEn`；有 logo 時渲染 `<img>`，否則維持文字方塊 | 方砚 |
| `src/components/MobileNav.tsx` | 同上 | 方砚 |
| `src/components/Footer.tsx` | 新增 props：`brandName`、`brandNameEn` | 方砚 |
| `src/components/AdminNav.tsx` | 新增兩項導航（見 §3.6） | 方砚 |
| `src/app/page.tsx` | Hero 背景套用 `hero_bg_path` + 遮罩 `hero_overlay_opacity`；Hero 區塊改用 `.section-pad` | 方砚 |
| `src/app/events/page.tsx` | 改讀 DB：`getPublishedEvents()` → `<EventCard>`；無活動時維持現有兩張主線卡 + 參加流程 + CTA 作為 fallback（**一字不改保留現有文案**） | 方砚 |
| `src/app/run/RunUploadForm.tsx` | 改為：壓縮 → 直傳 → `POST /api/runs` JSON；錯誤訊息見 FE-12 | 方砚 |
| `src/lib/theme.ts` | **新增**（owner 白客）：`SiteTheme` 型別、`DEFAULT_THEME`、`FONT_PRESETS`、`normalizeTheme(input, base)`、`themeCssVars(theme)`、`COLOR_PALETTE`（5 組客戶指定色） | 白客 |
| `src/lib/types.ts` | 新增 `Event` / `EventStatus` 型別（本輪由白客獨佔修改） | 白客 |
| `src/lib/queries.ts` | 新增 `getSiteTheme()` / `getPublishedEvents()` / `getAdminEvents()`；改寫 `getMonthlyLeaderboard()` | 白客 |
| `src/lib/utils.ts` | 新增 `todayISO()`（Asia/Macau） | 白客 |
| `src/lib/supabase/server.ts` | `getCurrentProfile` 用 `cache()` 包裹 | 白客 |
| `src/lib/supabase/anon.ts` | **新增**：不含 cookie 的純匿名讀取客戶端（供 `getSiteTheme` 使用，避免 cookies 與 `unstable_cache` 衝突） | 白客 |
| `src/lib/api.ts` | **新增**：`ApiErrorCode`、`jsonOk()` / `jsonErr()` helper | 白客 |
| `src/lib/config.ts` | 本輪**只由白客**修改（`MAX_UPLOAD_SOURCE_MB`、`MAX_UPLOAD_BYTES`；`BRAND.name` 等維持作為 `DEFAULT_THEME` 的預設值來源） | 白客 |
| `next.config.ts` | 刪除 `experimental.serverActions`（H1）；保留 `images.remotePatterns` | 白客 |

### 3.2 圖片上傳統一流程（H2 的唯一答案）

```
[使用者選檔]
  ↓ 前端驗證：檔名列白名單、原檔 ≤ 12MB（>12MB 直接擋，不上傳）
[compressImage()]  canvas 重繪 → 長邊 ≤1600 → toBlob(quality 0.82)
  ↓ 若結果 > 1.2MB：quality -0.12 重試（最多 3 次），仍過大則長邊改 1280 再壓一次
[supabase.storage.from(bucket).upload(path, blob, { upsert:false, cacheControl:"31536000" })]
  ↓ 成功
[path 以 JSON 送給 Route Handler] → Route Handler 做 Storage 存在性檢查 → 寫 DB
```

**選擇「瀏覽器直傳」而非「壓縮後仍送 API」的四個理由**

1. **徹底脫鉤平台上限**：檔案位元組不過 Vercel Function，4.5MB 限制直接失效，不存在「再踩一次 413」的風險。
2. **錯誤可診斷**：`supabase-js` 回傳結構化 `{ data, error }`（含 `statusCode`、`error.message`），前端能顯示真實原因；走 Vercel 超載時會拿到非 JSON 的 HTML，正是需求 D 無從診斷的原因。
3. **更快且更省**：少一跳中轉，Vercel Function 記憶體與執行時間都不再被圖片拖累（間接改善需求 C 的伺服器回應時間）。
4. **仍受 RLS 保護**：直傳用的是瀏覽器的 Supabase session JWT，`site-assets` 的寫入 policy 限制只有 `is_admin()`，安全性與走 API 完全等價。

**HEIC 處理**：`file.type` 或副檔名為 `heic/heif` 時，`compressImage` 直接拋出可顯示錯誤：`iPhone 的 HEIC 照片無法直接使用，請在「設定 → 相機 → 格式」改為「相容性最佳」，或先轉成 JPG 再上傳。`

**錯誤訊息映射表（前端必須照做）**

| Supabase Storage 錯誤 | 顯示給使用者 |
|---|---|
| HTTP 400 policy / `new row violates row-level security` | `沒有上傳權限，請重新登入後再試。` |
| HTTP 401 / JWT expired | `登入逾期，請重新登入。` |
| HTTP 413 / payload too large | `圖片過大，請改用較小或較短邊的照片。` |
| `TypeError: Failed to fetch` / network | `網路中斷，請檢查連線後重新上傳。` |
| 其他 | `圖片上傳失敗：{error.message}` |

### 3.3 CSS 變數命名與注入方式

**注入點：`src/app/layout.tsx`（Server Component，owner 方砚）**

```tsx
const theme = await getSiteTheme();                 // 白客提供
const cssVars = themeCssVars(theme);                // Record<`--${string}`, string>

<html lang="zh-Hant" className="h-full antialiased" style={cssVars as React.CSSProperties}>
  <body className="flex min-h-full flex-col bg-ink text-white">
    <NavProgress />
    {/* ... */}
    <Nav logoUrl={publicAssetUrl(theme.logo_path)} brandName={theme.brand_name} brandNameEn={theme.brand_name_en} /* 既有 props 不變 */ />
    {/* ... */}
    <Footer brandName={theme.brand_name} brandNameEn={theme.brand_name_en} /* 既有 props 不變 */ />
```

- **不使用動態 `<style>` 標籤**（安全，見 §1.5）。
- `themeCssVars()` 輸出鍵值對（白客負責），前端直接展開。

| CSS 變數 | 預設值 | 用途 / 消費處 |
|---|---|---|
| `--color-ink` | `#0F0F0F` | `body` 底色、`bg-ink` |
| `--color-ink-soft` | `#161616` | `.card-dark` 底色、`bg-ink-soft` |
| `--color-ink-line` | `#262626` | 所有 `border-ink-line`、`.card-dark` 邊線 |
| `--color-paper` | `#F5F5F7` | `.card-light` 底色、`bg-paper`、`text-ink` 區塊 |
| `--color-cobalt` | `#0047AB` | `.btn-cobalt` 底色、`bg-cobalt` |
| `--color-cobalt-bright` | `#0057FF` | hover、`.field:focus` 描邊、**NavProgress 進度條** |
| `--color-vital` | `#E3001B` | `.btn-vital`、`.eyebrow` |
| `--color-vital-bright` | `#FF2D2D` | hover |
| `--color-white` | `#FFFFFF` | 文字主色 |
| `--font-sans` | `FONT_PRESETS.classic` | `body { font-family: var(--font-sans) }`；`@theme` 內同名變數請保留以維持 Tailwind `font-sans` |
| `--radius-card` | `16px` | `.card-dark` / `.card-light` |
| `--radius-btn` | `9999px` | `.btn-base` |
| `--radius-field` | `12px` | `.field` |
| `--container-max` | `1200px` | `.container-msw { max-width: var(--container-max) }` |
| `--space-section` | `80px` | `.section-pad { padding-block: var(--space-section) }` |

**管理員色票（客戶指定的 5 組，放在 `COLOR_PALETTE`）**

| 顯示名 | Hex | 提供給哪些欄位當快速選擇 |
|---|---|---|
| 近黑 | `#0F0F0F` | `color_ink`、`color_ink_soft`、`color_ink_line` |
| 純白 | `#FFFFFF` | `color_white`、`color_paper` |
| 鈷藍 | `#0047AB` ／ 亮鈷藍 `#0057FF` | `color_cobalt` / `color_cobalt_bright` |
| 活力紅 | `#E3001B` ／ 亮紅 `#FF2D2D` | `color_vital` / `color_vital_bright` |
| 淺灰白 | `#F5F5F7` | `color_paper` |

每個顏色欄位同時提供：**5 組色票 chip + 原生 `<input type="color">` + 六碼 hex 文字輸入**。

**字體預設（`FONT_PRESETS`）**

| key | 顯示名 | 字體堆疊（全部在地系統字，不載外部字體） |
|---|---|---|
| `classic` | 現代無襯線（現況） | `Inter, "PingFang TC", "PingFang SC", "Microsoft JhengHei", "Noto Sans TC", "Helvetica Neue", Helvetica, Arial, sans-serif` |
| `system` | 系統預設 | `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif` |
| `serif` | 襯線（正式感） | `"Songti TC", "Noto Serif TC", Georgia, "Times New Roman", serif` |
| `custom` | 自訂 | 使用 `font_stack_custom` 的值（驗證規則見 §2.6） |

### 3.4 `globals.css` 必改內容（owner：方砚，逐條）

| 現況 | 改為 |
|---|---|
| `.container-msw { max-width: 1200px }` | `max-width: var(--container-max, 1200px)` |
| `.card-dark { border-radius: 1rem }` | `border-radius: var(--radius-card, 1rem)` |
| `.card-light { border-radius: 1rem }` | `border-radius: var(--radius-card, 1rem)` |
| `.btn-base { border-radius: 9999px }` | `border-radius: var(--radius-btn, 9999px)` |
| `.field { border-radius: 0.75rem }` | `border-radius: var(--radius-field, 0.75rem)` |
| 無 | 新增 `.section-pad { padding-block: var(--space-section, 80px); }` |
| `@theme` 內的 `--color-*`、`--font-sans` | **保留**（Tailwind utilities 需要），由 `<html style>` 覆蓋其值 |

> `@theme` 裡的樣式跑到 `@layer theme`，utilities 層的值都是 `var(--color-*)` 的引用；inline style 設在 `<html>` 上權重最高，因此全部 utilities 會自動跟著變，**不需要改任何 JSX 的 class 名稱**。

### 3.5 `NavProgress` 演算法規格（不得用不存在的 router.events）

1. Client Component，`position: fixed; top:0; left:0; height:2px; z-index:100`，背景 `var(--color-cobalt-bright)` → `var(--color-vital-bright)` 漸層。
2. `document` 上註冊 **capture 階段** `click` 監聽：點到 `a[href^="/"]`（同源、非 `_blank`、非錨點 `#`）→ 開始動畫（寬度 0→85%，300ms）。
3. `usePathname()` + `useSearchParams()` 變化 → 補滿 100% 後淡出。
4. **保險機制**：開始後 4 秒若 pathname 未變化 → 自動淡出（避免卡死的假進度條）。
5. 元件卸載時移除監聽。
6. 明確禁止使用 `next/navigation` 的 `router.events`（App Router 已移除）。

### 3.6 `AdminNav` 導航項（owner 方砚）

```ts
const LINKS = [
  { href: "/admin",            label: "總覽",            icon: LayoutDashboard, exact: true },
  { href: "/admin/runs",       label: "跑步審核",        icon: ClipboardCheck },
  { href: "/admin/checkins",   label: "簽到確認",        icon: Users },
  { href: "/admin/monthly",    label: "月度名單 / 發券", icon: Gift },
  { href: "/admin/coupons",    label: "優惠券",          icon: TicketCheck },
  { href: "/admin/sessions",   label: "訓練場次",        icon: CalendarPlus },
  { href: "/admin/events",     label: "活動管理",        icon: CalendarDays },   // 新增
  { href: "/admin/site-settings", label: "網站設定",     icon: Palette },        // 新增（放最後）
];
```

---

## 4. 效能策略（需求 C）

### 4.1 現況量化

每次頁面請求的網路來回（Vercel Function ↔ Supabase，跨境，估 60–300ms/次）：

| 來源 | 次數 | 可否省 |
|---|---|---|
| `src/proxy.ts`：`supabase.auth.getUser()` | 1（限 `/admin`、`/dashboard`） | 否（維持登入檢查） |
| `layout.tsx`：`getCurrentProfile()` = `auth.getUser()` + `profiles.select` | 2 | 可用 `cache()` 去重 |
| 頁面再次呼叫 `getCurrentProfile()`（layout 與 page 各一次） | 再 2（多數頁面） | **可完全省掉**（`cache()`） |
| `getMonthlyLeaderboard()`：統計 + 補暱稱 | 2（且是序列） | 改成 view → 1 |
| `attachImageUrls()`：批次簽章 | 1（有資料時） | 否 |
| 其餘各查詢 | 1 起跳 | 平行化後計 1 |

**根因結論**：不是 SQL 慢，是**請求數多 + 序列等待 + 完全沒有 loading 畫面**，三者疊加造成體感 8 秒。另有兩個外部因素必須由 PM 處理：① Supabase 免費專案 **7 天無活動會暫停**，喚醒要數十秒；② Vercel 函式區域若仍是預設（美國），與 Supabase（多半新加坡/東京）單次來回 200ms 起跳。

### 4.2 Vercel 函式區域（hkg1）可行性評估

| 項目 | 結論 |
|---|---|
| 是否可行 | **可行且建議做**。Vercel Hobby 支援在 Project Settings → Functions → Function Region 選擇 `hkg1`（香港）。此設定**不由 `vercel.json` 控制**，需 PM 到 Dashboard 操作。 |
| 預期效益 | Vercel↔Supabase（新加坡 `ap-southeast-1`）由 ~200ms 降到 ~35ms；瀏覽器（澳門/香港）↔Vercel 由 ~250ms 降到 ~30ms。**對首頁這種 6–9 次來回的頁面，粗估節省 1.5–2.5 秒。** |
| 前置確認 | 先到 Supabase Project Settings 確認專案實際 region；若在日本（`ap-northeast-1`），`hkg1` 仍優於美國但差距較小。 |
| 副作用 | 無功能性副作用。EdgeOne WAF 若擋在特定 CDN 節點，理論上走香港節點離目標更近，風險更低。 |
| 驗證方式 | 部署後用瀏覽器 DevTools Network 看第一個 document request 的 `Timing → Waiting (TTFB)`，目標 < 600ms；連續 5 次取中位數。 |

### 4.3 逐頁 `force-dynamic` 去留（**本次 R6 的答案：全部保留**）

> **為什麼不能改 ISR？**
> `src/app/layout.tsx` 呼叫 `getCurrentProfile()`（會讀 cookie），App Router 中**任何祖先 layout 使用動態 API，其下所有路由都會轉成動態**。因此只要 root layout 維持讀會員狀態，`/events`、`/` 就算寫 `revalidate = 300` 也不會真的被 statically generated，還會造成「快取了但其實是動態」的混亂。
> 真正能拿到分段/快取收益的做法有兩種：① 本契約採用的 `loading.tsx` + `Suspense`（立刻有畫面）；② [P1 待拍板] 把 Nav/Footer 會員狀態客戶端化（`/api/me`），root layout 不再讀 cookie，之後才有資格談 ISR。

| 路由 | 檔案 | R6 是否保留 `force-dynamic` | 理由 | `loading.tsx` | 平行化改造 |
|---|---|---|---|---|---|
| `/` | `src/app/page.tsx` | **保留** | Hero CTA 依登入狀態切換；`layout` 已動態 | ✔ `src/app/loading.tsx` + `src/app/page.tsx` 同層 | 已有 `Promise.all`；再加 `getSiteTheme()` 到同一個 `Promise.all` |
| `/events` | `src/app/events/page.tsx` | **保留** | 同上；**同時移除 `getCurrentProfile()` 呼叫**，CTA 改為不分登入狀態的固定兩顆按鈕（查看訓練場次 / 上傳跑步紀錄） | ✔ `src/app/events/loading.tsx` | `getPublishedEvents()` 與 `getSiteTheme()` 平行 |
| `/training` | `src/app/training/page.tsx` | **保留** | 顯示會員自己的報名/簽到狀態 | ✔ `src/app/training/loading.tsx` | 改為：`const [profile, sessions] = await Promise.all([getCurrentProfile(), getAllSessions(60)])`，再 `checkins` 依 profile 結果單獨 await |
| `/run` | `src/app/run/page.tsx` | **保留** | 同上 | ✔ `src/app/run/loading.tsx` | 同上模式 |
| `/leaderboard` | `src/app/leaderboard/page.tsx` | **保留** | 使用 `searchParams`（本身就動態）+ 會員狀態 | ✔ `src/app/leaderboard/loading.tsx` | 已有 `Promise.all`；改用 `monthly_leaderboard` view 省 1 次 |
| `/dashboard` | `src/app/dashboard/page.tsx` | **保留** | 會員專屬資料 | ✔ `src/app/dashboard/loading.tsx` | 已有 `Promise.all`（5 支查詢），維持 |
| `/dashboard/coupons` | `src/app/dashboard/coupons/page.tsx` | **保留** | 同上 | ✔ `src/app/dashboard/coupons/loading.tsx` | `profile` 之後單查 1 次即可，維持 |
| `/admin`（layout） | `src/app/admin/layout.tsx` | **保留** | 管理者檢查 | ✔ `src/app/admin/loading.tsx` | 維持 |
| `/admin` | `src/app/admin/page.tsx` | **保留** | 管理者資料 | ✔ `src/app/admin/loading.tsx`（共用） | 已有 `Promise.all` |
| `/admin/runs` | `src/app/admin/runs/page.tsx` | **保留** | 同上 | ✔ `src/app/admin/runs/loading.tsx` | 單查詢 + `searchParams`，維持 |
| `/admin/checkins` | `src/app/admin/checkins/page.tsx` | **保留** | 同上 | ✔ `src/app/admin/checkins/loading.tsx` | 單查詢 |
| `/admin/monthly` | `src/app/admin/monthly/page.tsx` | **保留** | 同上 | ✔ `src/app/admin/monthly/loading.tsx` | 已有 `Promise.all` |
| `/admin/coupons` | `src/app/admin/coupons/page.tsx` | **保留** | 同上 | ✔ `src/app/admin/coupons/loading.tsx` | 已有 `Promise.all` |
| `/admin/sessions` | `src/app/admin/sessions/page.tsx` | **保留** | 同上 | ✔ `src/app/admin/sessions/loading.tsx` | 維持 |
| `/admin/events` | 新增 | **保留** | 同上 | ✔ `src/app/admin/events/loading.tsx` | 單查詢（含篩選） |
| `/admin/site-settings` | 新增 | **保留** | 同上 | ✔ `src/app/admin/site-settings/loading.tsx` | 單查詢 |
| `/login` `/signup` | 既有 | **維持靜態**（本來就沒有 `force-dynamic`，不要加） | 純客戶端表單 | ✖ 不需要 | — |

**`loading.tsx` 檔案清單（共 15 個新檔 + 1 個 admin 共用）**

```
src/app/loading.tsx                          ← 根 fallback（所有未單獨定義的路由）
src/app/events/loading.tsx
src/app/training/loading.tsx
src/app/run/loading.tsx
src/app/leaderboard/loading.tsx
src/app/dashboard/loading.tsx
src/app/dashboard/coupons/loading.tsx
src/app/admin/loading.tsx
src/app/admin/runs/loading.tsx
src/app/admin/checkins/loading.tsx
src/app/admin/monthly/loading.tsx
src/app/admin/coupons/loading.tsx
src/app/admin/sessions/loading.tsx
src/app/admin/events/loading.tsx
src/app/admin/site-settings/loading.tsx
```

> **為什麼 `loading.tsx` 是本次最有感的優化**：客戶端點擊 `<Link>` 時，Next 會去抓目標路由的 RSC payload。**沒有 `loading.tsx` 就沒有 Suspense 邊界，Router 必須等到整份 payload 回來才切畫面**，使用者看到的就是「點擊後完全沒反應 8 秒」。加上 `loading.tsx` 後，Router 立刻顯示骨架畫面，實際資料串流完成再替換 —— 體感瞬間改善，且**這是唯一不必犧牲動態性就能拿到即時回饋的手段**。

### 4.4 DB 查詢平行化 / 去重清單（全部 owner：白客）

| # | 改造 | 位置 | 預期收益 |
|---|---|---|---|
| Q1 | `getCurrentProfile()` 用 `cache()` 包裹（React request memoization） | `src/lib/supabase/server.ts` | 每頁省 2 次來回（layout + page 只查一次） |
| Q2 | `getSiteTheme()`：`unstable_cache(fn, ["site-theme"], { tags:["site-theme"], revalidate: 60 })`，內部用**不含 cookie 的匿名客戶端**（`src/lib/supabase/anon.ts`） | `src/lib/queries.ts` | 每頁省 1 次來回（命中快取時 0 次） |
| Q3 | 新增 view `monthly_leaderboard`，改寫 `getMonthlyLeaderboard()` 用它（1 次來回） | `schema-r6.sql` + `queries.ts` | 首頁/排行榜各省 1 次 |
| Q4 | 所有頁面的多次查詢一律 `Promise.all`（`/training`、`/run` 目前是序列） | 各 page.tsx（方砚配合） | wall-clock 由「加總」變「最大值」 |
| Q5 | 維持現有 `getAdminCounts()` / dashboard 的 `Promise.all` 寫法，不得退回序列 | — | 保持 |
| Q6 | `getPublishedEvents()` 單次查詢上限 50 筆並附 index | `queries.ts` | 前台單次來回 |

> **`unstable_cache` 風險註記**：Next 16.3 仍由 `next/cache` 匯出。若該 API 實際上失效或出現型別錯誤，**決策已定**：退回 `React.cache()`（只做同一請求內去重，沒有 60 秒跨請求快取），實作時不得自行改成其它方案。

### 4.5 暫停喚醒與 health check（PM 需處理）

- 新增 `GET /api/health`（不查 DB）。
- 由 **UptimeRobot（免費）或 Vercel Cron** 每 **12 小時**打一次 `https://{domain}/api/health`，避免 Supabase 免費專案因 7 天無活動而暫停。
- 驗收：連續 7 天後觀察任何頁面的 TTFB 不應出現 > 10 秒的尖峰。

---

## 5. 任務清單

> 每列都必須可被「單一行為」驗證。**負責角色**：後端＝白客，前端＝方砚。

### 5.1 後端（白客）

| # | 任務 | 驗收標準 |
|---|---|---|
| BE-1 | 撰寫並執行 `supabase/schema-r6.sql`：`events` 表、index、`touch_updated_at` trigger、RLS policy、grant | ① 連續執行腳本 2 次都成功且無錯誤；② 以 anon 角色 `SELECT * FROM events` 只能看到 `status='published'` 的列；③ 以管理者 JWT 可看到全部三種 status；④ 以一般會員 JWT `INSERT INTO events` 被 RLS 拒絕 |
| BE-2 | 新增 `app_settings` 的 `site_theme` 預設列 + `monthly_leaderboard` view | ① `SELECT value FROM app_settings WHERE key='site_theme'` 回傳含 22 個欄位的 JSONB；② 重複執行不覆蓋已修改過的值；③ `SELECT * FROM monthly_leaderboard LIMIT 1` 可同時拿到 `total_km` 與 `display_name` |
| BE-3 | 建立 `site-assets` bucket（public）與 3 條 policy | ① Dashboard 顯示 bucket 為 Public；② 非管理員帳號在瀏覽器直傳 `site-assets/logo/x.png` 失敗（403）；③ 匿名 `curl https://{url}/storage/v1/object/public/site-assets/{已知 path}` 回 200 且 content-type 為 image |
| BE-4 | `getCurrentProfile()` 用 `cache()` 包裹；新增 `todayISO()` 到 `src/lib/utils.ts` | ① 首頁單次請求中 Supabase logs 只出現 1 次 `GET /rest/v1/profiles?select=*`；② `todayISO()` 在 UTC 時間 2026-09-30T17:00Z 時回 `2026-10-01` |
| BE-5 | 新增 `src/lib/supabase/anon.ts`（無 cookie 匿名客戶端）與 `getSiteTheme()`（60 秒 cache、tag `site-theme`） | ① root layout 與 admin 設定頁同時呼叫，同一請求只打 1 次 DB；② 60 秒內第二個請求不打 DB（以 Supabase logs 驗證）；③ 呼叫 `revalidateTag("site-theme")` 後下一請求一定重查 |
| BE-6 | `getPublishedEvents()` / `getAdminEvents(includeArchived)` | ① 前台只看得到 `published` 且 `event_date >= todayISO()` 的活動，依 `event_date` 升冪、`sort_order` 降冪；② 後台可依參數拿到含 `draft`、`archived` 的全部活動；③ 匿名直接呼叫看到的是 published 集合（與 RLS 一致） |
| BE-7 | 改寫 `getMonthlyLeaderboard()` 改用 `monthly_leaderboard` view | ① 輸出欄位與既有 `LeaderRow` 完全一致（回歸無破壞）；② 該函式的 Supabase 請求數由 2 降為 1 |
| BE-8 | 新增 `src/lib/theme.ts`：`SiteTheme`、`DEFAULT_THEME`、`FONT_PRESETS`、`COLOR_PALETTE`、`normalizeTheme()`、`themeCssVars()` | ① `normalizeTheme({}, DEFAULT_THEME)` 回傳完整 22 欄位且等於預設；② 對 `color_ink` 傳 `"red;}"` 回傳錯誤而非寫入；③ `themeCssVars()` 回傳的 key 恰好等於 §3.3 表格的 15 個變數名 |
| BE-9 | `POST /api/admin/events` | ① 匿名 POST 回 401；② 一般會員 POST 回 403；③ 缺 `title` 回 400 且 `fields.title` 存在；④ `cover_path` 指向不存在物件回 400 `封面圖片不存在，請重新上傳。`；⑤ 合法 payload 回 201 且 DB 多一列 `created_by` = 呼叫者 uid；⑥ `registration_url` 與 `registration_note` 都沒填回 400 |
| BE-10 | `PATCH /api/admin/events`（完整更新 + `statusOnly` 上下架） | ① 換封面後舊圖從 Storage 消失、DB `cover_path` 更新；② `cover_path` 傳不存在的值時 **DB 不被修改**（先查後寫）；③ 只帶 `{id,status:"published",statusOnly:true}` 能從 archived 復原；④ 非管理員 PATCH 回 403 |
| BE-11 | `DELETE /api/admin/events`（軟刪除 + `confirm` 保護） | ① 缺 `confirm:true` 回 400 `請先勾選「確認下架此活動」再執行。`；② 成功後該列 `status='archived'` 且**資料仍在**；③ 再次 DELETE 同一 id 回 409；④ Storage 封面物件**未被刪除** |
| BE-12 | `POST /api/admin/site-settings` | ① 22 個欄位全合法 → 200 且 `app_settings.updated_at` 更新；② `color_vital` 傳 `#ggg` → 400 `fields.color_vital`；③ `font_stack_custom` 含分號 → 400；④ 換 Logo 後舊物件被刪；⑤ `revalidateTag("site-theme")` 有被呼叫（儲存後重載前台 60 秒內看到新色） |
| BE-13 | `DELETE /api/admin/site-settings`（回復原廠） | ① 執行後 `site_theme` 值等於 `DEFAULT_THEME`；② **events / run_submissions / coupons 三張表的列數完全不變**；③ 非管理員呼叫回 403 |
| BE-14 | 改造 `POST /api/runs` 為 JSON-only | ① 送 FormData（`fetch` multipart）回 400 `資料格式錯誤。`；② `image_path` 不以呼叫者 uid 開頭 → 400；③ `image_path` 不存在 → 400 `截圖上傳失敗，請重新上傳後再提交。`；④ 合法請求回 200 且 `run_submissions` 多一列；⑤ **用 6MB 的圖測試，不再觸發 Vercel 413**（改用直傳後無此問題） |
| BE-15 | 新增 `GET /api/health` | ① `curl` 回 200 JSON `{ok:true, ts:...}`；② 完全不查 DB（Supabase logs 無記錄） |
| BE-16 | 新增 `src/lib/api.ts`（錯誤碼 + `jsonOk`/`jsonErr`）；所有新增與改造的 Route Handler 一律用 try/catch 包住 | ① 臨時在 handler 第一行插入 `throw new Error("boom")` 後請求該 API，回應仍然是 `content-type: application/json` 的 500 且 body 為 `{"ok":false,"error":"伺服器錯誤，請稍後再試。"}`（不是 HTML 錯誤頁）；② 全部 API 回應的 content-type 皆含 `application/json` |
| BE-17 | `next.config.ts` 刪除 `experimental.serverActions`；`src/lib/config.ts` 調整上傳常數 | ① `grep -r "serverActions" src next.config.ts` 無結果；② `grep -rn "use server" src` 無結果；③ `MAX_UPLOAD_SOURCE_MB=12`、`MAX_UPLOAD_BYTES=1200000` 存在且被前端使用 |
| BE-18 | `/events` 相關資料流聯調支援（提供種子資料 SQL 供測試） | ① 提供一段可重複執行的 INSERT 產生 3 筆活動（含 1 筆 draft、1 筆已過期）；② 執行後前台 `/events` 只出現符合規則者 |
| BE-19 | `[P1 待 PM 拍板]` `GET /api/me`（未拍板前不要寫） | — |

### 5.2 前端（方砚）

| # | 任務 | 驗收標準 |
|---|---|---|
| FE-1 | `src/lib/image-compress.ts` | ① 4000×3000 的原圖壓縮後長邊 = 1600 且體積 < 1.2MB；② HEIC 檔拋出指定中文錯誤；③ 結果 bytes 仍 > 1.2MB 時自動降品質重試（用 12MB 原圖實測最終 ≤ 1.2MB）；④ 壓縮後 `File.name` 副檔名與 mime 一致 |
| FE-2 | `src/lib/assets.ts` + `src/lib/upload.ts` | ① `uploadImageFile(file,'event')` 成功後回傳 `events/{yyyymm}/{ts}-{rand}.{ext}` 且 Storage 看得到該物件；② 用非管理員帳號上傳 `logo/` 失敗時顯示 `沒有上傳權限，請重新登入後再試。`；③ 斷網時顯示 `網路中斷，請檢查連線後重新上傳。`；④ 同檔連續上傳兩次路徑不同（不覆寫） |
| FE-3 | `src/lib/fetch-json.ts`（含非 JSON 回應處理） | ① 收到 413 HTML 時顯示 `伺服器回應異常（HTTP 413），請稍後再試。` 且不拋未捕獲例外；② 正常情境的行為與既有寫法一致 |
| FE-4 | `AdminNav` 新增「活動管理」「網站設定」兩項 | ① 兩項在桌面側欄與手機橫向選單都可見、可點擊；② 在 `/admin/events` 時「活動管理」呈 active 樣式（既有 `bg-vital text-white` 規則） |
| FE-5 | `AssetUploader` 共用元件 | ① 可上傳、可預覽、可「更換」、可「移除」（移除後 `value` 變 null）；② 上傳中禁用所有操作並顯示 spinner；③ `disabled` 生效；④ 事件封面使用 16/9 預覽框、Logo 1/1、Hero 2/1 |
| FE-6 | `/admin/events` 頁面 + `EventManager` | ① 列表顯示全部非 archived 活動（含 status 徽章）；② 新增後列表立即出現（不需手動重整）；③ 上架/下架按鈕點擊後徽章即時變換；④ 「已下架」篩選器可看到 archived 活動並可一鍵復原；⑤ 刪除需勾選確認才可按鈕 |
| FE-7 | `/admin/events/loading.tsx` 骨架 | ① 冷啟動時先出現骨架再出現列表；② 骨架版面與真實列表高度接近（不跳版） |
| FE-8 | `/admin/site-settings` 頁面 + `SettingsForm` | ① 22 個欄位都能編輯並顯示目前值（初次進入顯示 DB 預設值）；② 顏色可用色票 chip 一鍵帶入；③ 儲存成功出現綠色提示 `網站設定已儲存，重新載入頁面後生效。`；④ 單一欄位驗證失敗時該欄位下方出現紅字（來自 `fields`） |
| FE-9 | `DELETE /api/admin/site-settings` 的 UI（回復原廠按鈕） | ① 點擊需 `window.confirm` 二次確認；② 取消後不送出；③ 執行後表單欄位全部回到預設值 |
| FE-10 | `layout.tsx` 注入 CSS 變數 + `NavProgress` | ① 檢視原始碼時 `<html>` 上帶有 `style="--color-ink:#0F0F0F;..."` 共 15 個變數；② 在設定頁把 `color_vital` 改成 `#000000` 並重載後，`btn-vital` 按鈕背景變黑；③ 點擊任一內部連結立即出現頂部進度條，頁面載入完成後消失；④ 4 秒未換頁會自動消失（不會卡住） |
| FE-11 | `globals.css` 變數化 + `.section-pad` | ① `--container-max`、`--radius-card`、`--radius-btn`、`--radius-field`、`--space-section` 五個變數各自<｜hy_place▁holder▁no▁813｜>時畫面有對應變化；② 未注入變數時（fallback）畫面與現況完全一致（無破版） |
| FE-12 | `Nav` / `MobileNav` / `Footer` 接收品牌 props | ① 有 `logoUrl` 時 Nav 顯示圖片（高度 40px、長寬比不變形），無則維持「MSW」文字方塊；② `brandName` 改變後 Nav 與 Footer **同時**更新；③ 既有 props（`isLoggedIn` 等）行為不變 |
| FE-13 | 首頁 Hero 背景 | ① 有 `hero_bg_path` 時顯示背景圖並覆上 `hero_overlay_opacity` 的黑色遮罩，標題文字對比度仍可讀（Opacity 0.9 實測標題清晰）；② 無 `hero_bg_path` 時回到現有漸層+網格的樣子，**像素級別不變** |
| FE-14 | `/events` 讀 DB + `EventCard` + fallback | ① DB 有活動時卡片顯示封面、標題、副標、日期（含星期）、地點、名額、報名按鈕，點擊開新分頁帶 `rel="noopener noreferrer"`；② 報名連結為空時改顯示報名方式文字且不渲染空連結；③ **DB 無任何 published 活動時，畫面與舊的靜態頁完全相同**（含兩張主線卡、參加流程、CTA）；④ 封面圖 `loading="lazy"`、`decoding="async"`、帶明確 `width/height` 比例避免 CLS |
| FE-15 | `/events/loading.tsx` | 點進 `/events` 立即出現 3–6 張卡片骨架（不等 DB） |
| FE-16 | 其餘 13 個 `loading.tsx` + `Skeleton.tsx` | ① 15 個檔案清單與 §4.3 完全一致；② 由 `/dashboard` 點到 `/leaderboard` 會立刻出現排行榜骨架而非白畫面 |
| FE-17 | 各頁 `Promise.all` 平行化（`/training`、`/run`、`/events`、`/admin/*`） | ① `/training` 的 profile 與 sessions 同時發出（DevTools Network 中兩個 Supabase 請求幾乎同時出現）；② 平行化後畫面內容與現況一致 |
| FE-18 | `RunUploadForm` 改造（需求 D） | ① 選 6MB 的 PNG 也能成功提交（壓縮後 ≤1.2MB）；② 上傳 Storage 失敗時顯示 Storage 的中文錯誤，不是「網路錯誤」；③ 收到非 JSON 回應時顯示 `伺服器回應異常（HTTP {status}），請稍後再試。`；④ 提交成功後表單重設、列表 `router.refresh()` 更新；⑤ HEIC 檔直接顯示指定提示 |
| FE-19 | 全站按鈕在 pending 時 disabled + spinner（既有模式延伸到新頁面） | ① 新增/儲存/上架/上傳四種操作在 pending 時按鈕不可點且有旋轉圖示；② 不會出現重複送出（連點兩下只產生一筆 DB 列） |
| FE-20 | `[P1 待 PM 拍板]` Nav/Footer 客戶端化 + `/api/me` | — |

### 5.3 需求 E / F：安全性複驗與雙重驗證（三人協作）

| # | 任務 | 負責 | 驗收標準 |
|---|---|---|---|
| VF-1 | R6 安全性複驗：`SECURITY-AUDIT.md` 既有檢查表逐項重跑，並把 R6 新增的 3 支 admin API、1 個 public bucket、1 張新表納入，產出 `SECURITY-R6.md` | 白客 | ① 文件中每一項有「結果 / 證據（curl 或截圖）」兩欄，沒有寫「OK」卻沒證據的項；② 既有 2 個 Danger 維持已修補狀態；③ **匿名對所有 `/api/admin/**` 的 POST/PATCH/DELETE 全部 ≤ 403**（逐支列出） |
| VF-2 | 前端權限複驗：確認「前端隱藏」與「後端拒絕」同時成立 | 方砚 | ① 以一般會員帳號登入後，在瀏覽器 console 執行 `fetch('/api/admin/events',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})` 回 403（`ok:false`）；② 該帳號直接造訪 `/admin/events` 顯示「權限不足」頁面且不噴錯；③ admin 帳號在 `/admin/events` 可正常新增與上架 |
| VF-3 | 建置驗證：`pnpm build` + `pnpm lint` + `tsc --noEmit` | 白客 | ① 三個指令皆 0 error；② 不允許為通過檢查而加 `@ts-ignore` 或停用 eslint rule |
| VF-4 | agent 雙重驗證 | PM | ① **訪客 agent**：未登入狀態走過 `/`、`/events`、`/training`、`/run`、`/leaderboard`、`/login`、`/signup`，每個頁面 HTTP 200 且無 console error；點擊 Nav 每個連結都在 1 秒內出現 `loading` 畫面（截圖佐證）；② **管理員 agent**：完整走完活動 CRUD + 上下架 + 復原、網站設定儲存 + 回復原廠、跑步審核、'/admin/events' 上架後訪客能在 `/events` 看到新活動；③ 結果寫入 `VERIFICATION-R6.md`，含每個頁面的實測 TTFB 中位數（目標 < 1.5 秒，區域設定後） |

---

## 6. 檔案所有權表（避免同時改同一檔）

| 檔案 | Owner | 動作 | 說明 |
|---|---|---|---|
| `supabase/schema-r6.sql` | 白客 | 新增 | 唯一新增 SQL |
| `supabase/schema.sql` | 白客 | 改 1 行註解 | 方砚不得碰 |
| `src/lib/theme.ts` | 白客 | 新增 | 方砚**只讀**導入型別與函式 |
| `src/lib/types.ts` | 白客 | 改 | 「本輪白客獨佔，方砚需加型別請提出」 |
| `src/lib/config.ts` | 白客 | 改 | 同上 |
| `src/lib/utils.ts` | 白客 | 改（加 `todayISO`） | 方砚可使用，不改寫 |
| `src/lib/queries.ts` | 白客 | 改 | 方砚**呼叫，不改內容** |
| `src/lib/supabase/server.ts` | 白客 | 改 | — |
| `src/lib/supabase/anon.ts` | 白客 | 新增 | — |
| `src/lib/api.ts` | 白客 | 新增 | 前端不直接 import |
| `src/app/api/health/route.ts` | 白客 | 新增 | — |
| `src/app/api/admin/events/route.ts` | 白客 | 新增 | — |
| `src/app/api/admin/site-settings/route.ts` | 白客 | 新增 | — |
| `src/app/api/runs/route.ts` | 白客 | 改寫 POST | — |
| `src/app/api/me/route.ts` | 白客 | P1 | 待拍板 |
| `next.config.ts` | 白客 | 改 | — |
| `src/lib/image-compress.ts` | 方砚 | 新增 | — |
| `src/lib/assets.ts` | 方砚 | 新增 | — |
| `src/lib/upload.ts` | 方砚 | 新增 | — |
| `src/lib/fetch-json.ts` | 方砚 | 新增 | — |
| `src/components/NavProgress.tsx` | 方砚 | 新增 | — |
| `src/components/Skeleton.tsx` | 方砚 | 新增 | — |
| `src/components/AssetUploader.tsx` | 方砚 | 新增 | — |
| `src/components/EventCard.tsx` | 方砚 | 新增 | — |
| `src/app/admin/events/page.tsx` | 方砚 | 新增 | — |
| `src/app/admin/events/EventManager.tsx` | 方砚 | 新增 | — |
| `src/app/admin/site-settings/page.tsx` | 方砚 | 新增 | — |
| `src/app/admin/site-settings/SettingsForm.tsx` | 方砚 | 新增 | — |
| `src/app/globals.css` | 方砚 | 改 | — |
| `src/app/layout.tsx` | 方砚 | 改 | 呼叫白客提供的 `getSiteTheme()` |
| `src/app/page.tsx`（Hero） | 方砚 | 改 | — |
| `src/app/events/page.tsx` | 方砚 | 改 | — |
| `src/components/Nav.tsx` / `MobileNav.tsx` / `Footer.tsx` / `AdminNav.tsx` | 方砚 | 改 | — |
| `src/app/run/RunUploadForm.tsx` | 方砚 | 改 | — |
| `src/app/*/loading.tsx`（15 檔） | 方砚 | 新增 | — |
| `src/app/training/page.tsx`、`run/page.tsx`、`leaderboard/page.tsx`、`dashboard/**`、`admin/**` | 方砚 | 改（僅平行化 + 骨架） | 查詢邏輯若需改動，由方砚提出、白客改 `queries.ts` |
| `src/proxy.ts` | **本次無人改**（結凍） | — | 未經 PM 同意不得修改 |
| `SECURITY-R6.md` | 白客 | 新增 | — |
| `VERIFICATION-R6.md` | PM | 新增 | — |
| `SPEC-R6.md` | 任析 | 本文 | 任何人發現契約不足，先找我改本文 |

---

## 7. 《介面手動修改指南》規格（交給 PM 撰寫）

### 7.1 必須包含的章節

1. **開始前的安全聲明**
   - 永遠用後台「網站設定」改版面，**不要**直接編輯 `src/app/globals.css`。
   - 不要上傳超過 12MB 的原圖、不要用 iPhone 的 HEIC。
   - 任何修改都可以在設定頁按「回復原廠設定」還原；活動資料不受影響。
2. **後台網站設定操作手冊**：逐欄位說明（欄位名＝本文 §1.3 的 key、允許範圍、建議值、影響範圍、附上操作截圖編號）。
3. **CSS 變數對照表**（欄位見 7.2，內容對應本文 §3.3）。
4. **常見修改情境 SOP**（每條含：步驟、生效條件、還原方式）：更換 Logo／更換 Hero 背景／更換主色／更換字體／調整版面寬度與圓角與區塊留白／新增一則活動／更換活動封面／把活動下架又復原。
5. **圖片規格與上傳規範**：建議尺寸、長邊上限 1600、品質 0.82、體積目標 1.2MB 以內、HEIC 處理方式、為什麼不能用手機原檔。
6. **雲端在上（儲存後多久生效）**：儲存後自己重整即時看到；其他訪客最遲 60 秒。
7. **回復原廠設定會做什麼 / 不會做什麼**：只重置 `site_theme` 一列，活動、會員、積分、優惠券、跑步紀錄全部不動；已上傳的圖片物件不會被刪除（但頁面不再使用）。
8. **疑難排解表**：改了沒生效 → ① 是否按下「儲存設定」② 硬重整（Cmd/Ctrl+Shift+R）③ 換瀏覽器無痕模式 ④ 確認 Vercel 部署已完成 ⑤ 確認 Supabase 專案是否暫停。
9. **後台改不到的硬寫內容清單**（需工程師協助）：例如 `/events` 的 fallback 兩張主線卡文案、`src/lib/config.ts` 的 `DISCIPLINES`（訓練項目網格）、`BRAND.description`（SEO 描述）、參加流程四步驟文案、頁尾聯絡資訊。

### 7.2 對照表必要欄位（一行一個可改項目）

| 我想改的東西 | 後台欄位（key） | 對應 CSS 變數 | 影響的 Tailwind class / 元件 | 不必改程式？ | 後台沒有的話，要開哪個檔案 : 哪一段 | 風險等級 |
|---|---|---|---|---|---|---|
| 例：按鈕紅色 | `theme.color_vital` | `--color-vital` | `.btn-vital`、`bg-vital`、`.eyebrow` | 是 | — | 低 |

- **影響的 Tailwind class / 元件**：必須列到具體 class 或元件名（方砚提供清單）。
- **風險等級**：低（後台可改且可立即還原）／中（影響多處版面，建議先記下原值）／高（需工程師，誤改會破版）。
- 最少需填滿項目：9 個顏色 + 字體 + 3 個圓角 + 版面寬度 + 區塊留白 + Logo + Hero 背景 + 網站中英文名稱 + 兩句標語，共 **19 列**。

---

## 8. 假設、風險與待 PM 拍板事項

### 8.1 已做的假設（未再確認，若與事實不符請立刻回報）

1. Supabase 專案已執行過 `schema.sql`（`profiles`、`is_admin()`、`public_leaderboard`、`monthly_running_stats` 皆存在）。
2. Supabase 專案 region 多半在亞洲（新加坡或東京）；實際 region 需 PM 到 Dashboard 確認（影響 §4.2 的效益估算）。
3. 客戶能接受「活動刪除＝下架（可復原）」，不需要從資料庫徹底抹除。
4. 客戶能接受字型只能從 4 組內建堆疊選（不另外載 Google Fonts，以免拖慢載入）。
5. 管理員操作環境為現代瀏覽器（支援 canvas + `toBlob`），手機 Safari 亦可（不做 IE 與老 Android 相容）。

### 8.2 風險

| # | 風險 | 影響 | 建議對策 |
|---|---|---|---|
| R1 | **`unstable_cache` 在 Next 16.3 行為/匯出有變** | `getSiteTheme()` 失效或 build 不過 | 已預先決策：退回 `React.cache()`（僅請求內去重）。不得因此改寫成客戶端抓取。 |
| R2 | **Supabase 免費專案暫停**造成偶發 20–60 秒 | 客戶與 PM 可能誤判為「網站壞了」 | 務必做 BE-15 + §4.5 keep-alive；並在 DEBUG 指引中寫明此現象。 |
| R3 | **公開 bucket 的舊圖 CDN 快取**：若有人覆寫同一個 path，畫面可能不更新 | 客戶抱怨「換了圖卻沒變」 | 硬性規定：一律新檔名、`upsert:false`；更換後由伺服器刪舊檔。 |
| R4 | **inline style 變數被 Tailwind `!important` 類蓋掉**：若既有程式碼用了 `!px-5` 之類的 important utility，圓角相關的 `btn-base` 可能被蓋 | 少數按鈕圓角不跟著設定走 | FE-19 所列頁面以外若發現，回報任析決定是否統一移除 `!important`。已知 `Nav.tsx` 的 `!px-5 !py-2` 只影響 padding，不受影響。 |
| R5 | **移除 `getCurrentProfile()` 後 `/events` CTA 不再隨登入狀態變化** | 登入會員在 `/events` 看到的與訪客相同 | 已選此交換以避免 `/events` 多做 2 次 DB 來回；CTA 文字已改為對兩者都成立（「查看訓練場次」「上傳跑步紀錄」）。若客戶堅持要變，走 P1。 |
| R6 | 活動封面若上傳超大直式海報，16:9 卡片會裁切掉重點 | 客戶覺得封面「被切掉」 | 卡片用 `object-cover`，同時在後台上傳區標示建議比例 16:9 與建議尺寸 1600×900。 |
| R7 | 前後端同時改 `layout.tsx` / `queries.ts` 造成衝突 | 合併地獄 | 嚴格遵守 §6 所有權表；跨檔案需求一律透過本文的 props / 函式契約傳遞。 |

### 8.3 需 PM 拍板（未拍板前對應任務不得開工）

| # | 議題 | 選項 A | 選項 B | 任析的建議 |
|---|---|---|---|---|
| D1 | 是否要做 root layout 靜態化（BE-19 / FE-20，`/api/me` + client island）換取真正 ISR？ | 做：首頁/`/events` 可變 ISR，TTFB 可再降，但要改 Nav/Footer 載入方式，短期有「先顯示未登入狀態再跳變」的小瑕疵 | 不做：維持現狀 + `loading.tsx` + 平行化（本契約 P0） | **先做 A 案的 P0，上線量測 2 週後再決定**。若實測仍 > 3 秒才啟動 B。 |
| D2 | Vercel 函式區域是否切到 `hkg1`？ | 切 hkg1 | 維持預設（美國） | **切**。零程式風險，效益明確。 |
| D3 | Supabase 是否要升級付費版（不暫停 + 可選更近 region）？ | 維持免費 + keep-alive | 升級 | 維持免費，先靠 keep-alive；若客戶反映尖峰 > 5 秒再評估。 |
| D4 | 活動是否需要「隱藏（draft）」以外的**排程上架**（到指定時間自動上架）？ | 需要 | 不需要（本版僅手動） | 不需要，列入下期候選。 |
