/**
 * /admin/review 的載入骨架。
 *
 * 這一頁會依分頁打不同查詢（跑步提交／簽到／兌換申請／HYROX 名單），
 * 冷啟動時可能超過 1 秒。有 loading.tsx 才不會出現「點了沒反應」。
 * 三個灰塊對應：說明列、分頁列、第一張卡片。
 */
export default function Loading() {
  return (
    <div className="min-w-0 space-y-5" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-white/10" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-white/5" />
      </div>
      <div className="h-12 w-full animate-pulse rounded-xl bg-white/5" />
      <div className="h-40 w-full animate-pulse rounded-xl bg-white/5" />
      <p className="text-center text-xs text-white/40">正在讀取待審核清單…</p>
    </div>
  );
}
