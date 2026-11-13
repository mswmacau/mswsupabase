# HYROX 三個回饋修復 ＋ 往期回顧 — 截圖存證

全部由本機 `next dev`（localhost:3021）＋ Playwright（系統 Chrome）實拍，2026-11-13。

## 真實資料（線上 Supabase）

| 檔案 | 內容 |
| --- | --- |
| `admin-saved.png` | 後台儲存成功後的綠色橫幅：「已儲存「MSW 戶外 HYROX」（狀態：已上架）」，3 秒後淡出（腳本驗過淡出後提示數 = 0） |
| `admin-qr.png` | 表單上半部（緊接費用之後）的收款區：QR 上傳框、amber「未上傳收款碼，會員無法付款」、收款電話／說明 |
| `admin-qr-focus.png` | 由列表「未上傳收款碼（點擊上傳）」進入：表單自動滾到 QR 區並高亮（量到 `#hx-qr` top=240 / bottom=660，viewport 900，`ring-2` 生效） |
| `admin-unpublish.png` | 一鍵「下架」後的提示與卡片狀態（測試後已按「上架」還原，線上仍為 published） |
| `admin-form-top.png`、`admin-photos.png`、`admin-390.png` | 表單頂部、回顧相片區（後端 migration 未執行時的錯誤顯示）、後台 390 寬 |
| `detail-1440.png`、`detail-390.png` | `/hyrox/<已上架場次 id>` 詳情頁（該場次目前 0 張相片 → 顯示「相片整理中，稍後補上」空狀態） |
| `home-1440.png`、`home-390.png` | `/hyrox` 主頁（往期區塊目前不顯示，原因見下） |

## 本機 stub 資料（僅驗版面，不代表線上資料）

`supabase/migration-hyrox-photos.sql` 尚未在線上執行，`event_photos` 表不存在，且 anon 讀不到 archived 場次，
所以「往期區塊」與「有相片的詳情頁」暫時無法用真實資料截圖。以下幾張是**暫時在 `data.ts` 餵 2 場假場次＋6 張假相片**拍的，
拍完已還原（`grep TEMP-STUB src/` 為空）：

| 檔案 | 內容 |
| --- | --- |
| `past-section.png`、`past-section-390.png` | 往期場次卡片：日期、標題、「6 張相片」／「相片整理中」、箭頭；整張卡可點 |
| `detail-with-photos-1440.png`、`detail-with-photos-390.png` | 有相片的詳情頁：手機 2 欄、桌面 3 欄 |
| `detail-lightbox-1440.png` | 點相片開大圖（原生 `<dialog>`）：1/6 計數、上一張／下一張、關閉、說明；Esc 可關 |
| `home-1440-stub.png` | 含往期區塊的完整主頁 |

migration 執行後請重拍這幾張（前端程式不用改）。

## 量測結果

- 390 寬橫向溢出：`/hyrox`、`/hyrox/[id]`、`/admin/hyrox` 三頁 `scrollWidth === clientWidth === 390`。
- `/hyrox/99999999-9999-4999-8999-999999999999` → 顯示「找不到這個場次」（`notFound()` 生效）。
  ⚠️ HTTP 狀態仍是 200：站內根目錄 `loading.tsx` 造成串流先送 header，既有 `/v/[code]` 也是同樣行為（soft 404），非本次改動引入。
