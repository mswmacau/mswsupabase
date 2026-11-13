"use client";

/**
 * src/app/admin/hyrox/HyroxEventForm.tsx — 新增／編輯 HYROX 場次
 *
 * 端點：
 *   POST  /api/admin/hyrox/events   （新增，series 由伺服器寫死 'hyrox'）
 *   POST  /api/admin/hyrox/events   （更新，body 帶 action:'update' + id）
 * 不用既有的 /api/admin/events：那支的白名單沒有 series／fee_cents／payment_*，
 * 而且強制要 event_date 與「報名連結或報名方式」，會讓「日期待定」的場次存不進去。
 *
 * 日期留空 = 日期待定（前台顯示「日期待定」，報名按鈕換成「開放報名後通知我」）。
 *
 * 版面順序（客戶反映「找不到收款 QR」後調整）：
 *   標題 → 日期時間 → 地點名額 → 費用狀態 → **收款區（QR／電話／說明）** → 回顧相片
 *   收款區從表單最底部搬到費用之後，並在標題加一句「會員報名第三步會看到這張圖」。
 *
 * 成功回饋：儲存成功後把「已儲存（狀態：…）」交給父層在列表頂部顯示
 * （父層會淡出、並即時刷新卡片狀態），這裡不再靜默關閉。
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { AdminModal, Field, AdminError } from "@/components/admin/ui";
import { AssetUploader } from "@/components/AssetUploader";
import { EventPhotoManager } from "@/components/hyrox/EventPhotoManager";
import { postHyrox, type HyroxApiResult } from "@/components/hyrox/api";
import { eventDateValue, type HyroxEvent } from "@/components/hyrox/shared";

const STATUS_OPTIONS = [
  { value: "draft", label: "草稿（前台看不到）" },
  { value: "published", label: "已上架" },
  { value: "archived", label: "已下架（列入往期場次）" },
] as const;

/** 成功提示用的短標籤（不含括號說明） */
const STATUS_SHORT: Record<string, string> = {
  draft: "草稿",
  published: "已上架",
  archived: "已下架",
};

export function HyroxEventForm({
  event,
  onClose,
  onSaved,
  focus = null,
}: {
  /** null = 新增 */
  event: HyroxEvent | null;
  onClose: () => void;
  onSaved: (message: string) => void;
  /** "qr" = 開啟後直接滾到收款 QR 區並聚焦（列表的「未上傳收款碼」入口用） */
  focus?: "qr" | null;
}) {
  const router = useRouter();
  const isEdit = Boolean(event?.id);

  const [title, setTitle] = useState(event?.title ?? "");
  const [eventDate, setEventDate] = useState(event?.event_date ?? "");
  const [startTime, setStartTime] = useState(event?.start_time ?? "");
  const [endTime, setEndTime] = useState(event?.end_time ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [capacity, setCapacity] = useState(
    event?.capacity != null ? String(event.capacity) : ""
  );
  const [feeYuan, setFeeYuan] = useState(
    event?.fee_cents != null ? String(event.fee_cents / 100) : "50"
  );
  const [paymentPhone, setPaymentPhone] = useState(event?.payment_phone ?? "");
  const [paymentNote, setPaymentNote] = useState(event?.payment_note ?? "");
  const [qrPath, setQrPath] = useState<string | null>(
    event?.payment_qr_path ?? null
  );
  const [status, setStatus] = useState<string>(event?.status ?? "draft");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /** 收款區的定位與短暫高亮（從列表「未上傳收款碼」跳過來時看得到） */
  const qrRef = useRef<HTMLDivElement>(null);
  const [highlightQr, setHighlightQr] = useState(false);

  useEffect(() => {
    if (focus !== "qr") return;
    const el = qrRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true });
    setHighlightQr(true);
    const timer = setTimeout(() => setHighlightQr(false), 2000);
    return () => clearTimeout(timer);
  }, [focus]);

  async function submit() {
    setError(null);
    setFieldErrors({});

    const localFields: Record<string, string> = {};
    if (title.trim() === "") localFields.title = "請填寫場次標題。";
    const feeNum = Number(feeYuan);
    if (!Number.isFinite(feeNum) || feeNum < 0) {
      localFields.fee_cents = "費用請填 0 或正數（澳門幣）。";
    }
    if (capacity.trim() !== "") {
      const n = Number(capacity);
      if (!Number.isInteger(n) || n < 1) {
        localFields.capacity = "名額請填正整數，或留空表示不限。";
      }
    }
    if (Object.keys(localFields).length > 0) {
      setFieldErrors(localFields);
      return;
    }

    const payload = {
      // 後端契約：{ action:'create' | 'update', ...欄位 }；series 由伺服器寫死 'hyrox'
      action: isEdit ? "update" : "create",
      ...(isEdit ? { id: event?.id } : {}),
      title: title.trim(),
      // 空字串 → null（= 日期待定）
      event_date: eventDate.trim() === "" ? null : eventDate.trim(),
      start_time: startTime.trim() === "" ? null : startTime.trim(),
      end_time: endTime.trim() === "" ? null : endTime.trim(),
      location: location.trim() === "" ? null : location.trim(),
      capacity: capacity.trim() === "" ? null : Number(capacity),
      fee_cents: Math.round(feeNum * 100),
      payment_qr_path: qrPath,
      payment_phone: paymentPhone.trim() === "" ? null : paymentPhone.trim(),
      payment_note: paymentNote.trim() === "" ? null : paymentNote.trim(),
      status,
    };

    setPending(true);
    const res: HyroxApiResult<{ message?: string }> = await postHyrox(
      "/api/admin/hyrox/events",
      payload
    );
    setPending(false);

    if (res.ok) {
      // 明確講「已儲存 + 目前狀態」：客戶之前以為按了沒反應。
      // 只用自己組的訊息（後端的 message 內容相近，接在後面會變重複兩句）。
      onSaved(
        `已儲存「${title.trim()}」（狀態：${STATUS_SHORT[status] ?? status}）`
      );
      router.refresh();
      onClose();
      return;
    }

    setError(res.error);
    if (res.fields) setFieldErrors(res.fields);
  }

  const hasDate = eventDateValue(eventDate) !== null;
  const showPhotos = isEdit && Boolean(event?.id) && (status === "archived" || hasDate);

  return (
    <AdminModal
      title={isEdit ? "編輯場次" : "新增 HYROX 場次"}
      description="日期留空即為「日期待定」：前台會顯示待定，報名按鈕換成通知我。"
      onClose={() => {
        if (!pending) onClose();
      }}
      dismissible={!pending}
      width="max-w-2xl"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="btn-base btn-ghost"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={pending}
            className="btn-base btn-vital"
          >
            {pending ? (
              <>
                <Loader2 size={16} className="animate-spin" /> 儲存中…
              </>
            ) : (
              <>
                <Save size={16} /> 儲存
              </>
            )}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <AdminError message={error} />}

        <Field label="場次標題" htmlFor="hx-title" error={fieldErrors.title}>
          <input
            id="hx-title"
            className="field"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如 MSW 戶外 HYROX 11 月場"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="活動日期"
            htmlFor="hx-date"
            hint="留空 = 日期待定"
            error={fieldErrors.event_date}
          >
            <input
              id="hx-date"
              type="date"
              className="field"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
          </Field>
          <Field label="開始時間" htmlFor="hx-start" hint="例如 09:00">
            <input
              id="hx-start"
              className="field"
              value={startTime}
              maxLength={20}
              onChange={(e) => setStartTime(e.target.value)}
              placeholder="09:00"
            />
          </Field>
          <Field label="結束時間" htmlFor="hx-end" hint="例如 11:30">
            <input
              id="hx-end"
              className="field"
              value={endTime}
              maxLength={20}
              onChange={(e) => setEndTime(e.target.value)}
              placeholder="11:30"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="地點" htmlFor="hx-loc" className="sm:col-span-2">
            <input
              id="hx-loc"
              className="field"
              value={location}
              maxLength={120}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="例如 氹仔中央公園"
            />
          </Field>
          <Field
            label="名額"
            htmlFor="hx-cap"
            hint="留空 = 不限"
            error={fieldErrors.capacity}
          >
            <input
              id="hx-cap"
              type="number"
              min={1}
              className="field"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="30"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="費用（澳門幣）"
            htmlFor="hx-fee"
            hint="以元輸入，系統換算成分儲存；0 = 免費"
            error={fieldErrors.fee_cents}
          >
            <input
              id="hx-fee"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              className="field"
              value={feeYuan}
              onChange={(e) => setFeeYuan(e.target.value)}
            />
          </Field>
          <Field label="狀態" htmlFor="hx-status">
            <select
              id="hx-status"
              className="field"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* ===== 收款區（緊接費用之後，客戶反映原本在最底部找不到） ===== */}
        <div
          ref={qrRef}
          id="hx-qr"
          className={`rounded-xl border p-4 transition ${
            highlightQr
              ? "border-amber-400/70 bg-amber-400/[0.06] ring-2 ring-amber-400/40"
              : "border-ink-line bg-black/20"
          }`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-semibold text-white/85">收款</p>
            <p className="min-w-0 break-words text-xs text-white/50">
              會員報名第三步會看到這張圖
            </p>
          </div>

          <div className="mt-3">
            <p className="label">收款 QR 圖</p>
            <AssetUploader
              kind="event"
              aspect="1/1"
              value={qrPath}
              onChange={setQrPath}
              disabled={pending}
              hint="收款 QR；建議正方形 800×800。留空時前台顯示「請向管理員索取收款碼」。"
            />
          </div>

          {!qrPath && (
            <p
              role="status"
              className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200"
            >
              <AlertTriangle size={14} className="mt-0.5 flex-none" />
              <span className="min-w-0 break-words">
                未上傳收款碼，會員無法付款。上傳後前台報名第三步才會顯示 QR。
              </span>
            </p>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="收款電話"
              htmlFor="hx-phone"
              hint="轉帳／行動支付用，最長 30 字"
            >
              <input
                id="hx-phone"
                className="field"
                value={paymentPhone}
                maxLength={30}
                onChange={(e) => setPaymentPhone(e.target.value)}
                placeholder="例如 6612 3456"
              />
            </Field>
            <Field label="收款說明" htmlFor="hx-note" hint="最長 300 字">
              <input
                id="hx-note"
                className="field"
                value={paymentNote}
                maxLength={300}
                onChange={(e) => setPaymentNote(e.target.value)}
                placeholder="例如 轉帳後上傳截圖，兩個工作日內審核"
              />
            </Field>
          </div>
        </div>

        {/* ===== 回顧相片（存過一次、且已下架或有日期才顯示） ===== */}
        {showPhotos && event?.id && (
          <div className="rounded-xl border border-ink-line bg-black/20 p-4">
            <EventPhotoManager eventId={event.id} disabled={pending} />
            {status !== "archived" && (
              <p className="mt-2 text-xs leading-relaxed text-white/45">
                這一場還沒下架。相片可以先傳，前台要等場次列入往期（已下架）才看到。
              </p>
            )}
          </div>
        )}

        {isEdit && !showPhotos && (
          <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-xs leading-relaxed text-white/50">
            場次結束後（狀態設為「已下架」，或先填活動日期）就可以在這裡上傳回顧相片。
          </p>
        )}

        {!isEdit && (
          <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-xs leading-relaxed text-white/50">
            回顧相片要等場次存好之後才能上傳：先按「儲存」，再從列表按「編輯」進來。
          </p>
        )}
      </div>
    </AdminModal>
  );
}
