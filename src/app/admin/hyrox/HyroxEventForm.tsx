"use client";

/**
 * src/app/admin/hyrox/HyroxEventForm.tsx — 新增／編輯 HYROX 場次
 *
 * 端點（⚠️ 契約未涵蓋，已向前端契約提出）：
 *   POST  /api/admin/hyrox/events   （新增，series 由伺服器寫死 'hyrox'）
 *   PATCH /api/admin/hyrox/events   （更新，body 帶 id）
 * 不用既有的 /api/admin/events：那支的白名單沒有 series／fee_cents／payment_*，
 * 而且強制要 event_date 與「報名連結或報名方式」，會讓「日期待定」的場次存不進去。
 *
 * 日期留空 = 日期待定（前台顯示「日期待定」，報名按鈕換成「開放報名後通知我」）。
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { AdminModal, Field, AdminError } from "@/components/admin/ui";
import { AssetUploader } from "@/components/AssetUploader";
import { postHyrox, type HyroxApiResult } from "@/components/hyrox/api";
import type { HyroxEvent } from "@/components/hyrox/shared";

const STATUS_OPTIONS = [
  { value: "draft", label: "草稿（前台看不到）" },
  { value: "published", label: "已上架" },
  { value: "archived", label: "已下架（列入往期場次）" },
] as const;

export function HyroxEventForm({
  event,
  onClose,
  onSaved,
}: {
  /** null = 新增 */
  event: HyroxEvent | null;
  onClose: () => void;
  onSaved: (message: string) => void;
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
      onSaved(
        res.message ?? (isEdit ? "已更新場次。" : "已新增場次。")
      );
      router.refresh();
      onClose();
      return;
    }

    setError(res.error);
    if (res.fields) setFieldErrors(res.fields);
  }

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

        <div className="grid gap-4 sm:grid-cols-2">
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

        <div>
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
      </div>
    </AdminModal>
  );
}
