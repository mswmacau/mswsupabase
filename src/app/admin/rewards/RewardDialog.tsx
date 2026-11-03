"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { AssetUploader } from "@/components/AssetUploader";
import { AdminError, AdminModal, Field } from "@/components/admin/ui";
import { FetchError, postJson } from "@/lib/fetch-json";
import type { MerchantOption, RewardInput, RewardRow, RewardStatus } from "./types";

/**
 * 新增／編輯同一支表單。
 *  - 總庫存、每人上限留空 → 送 null（不限量／不限次）
 *  - 積分價與庫存都由後端再驗一次；欄位錯誤以 fields 回填
 *  - 圖片沿用 AssetUploader（kind="reward"，存 site-assets/rewards/）
 */
export function RewardDialog({
  reward,
  merchants,
  onClose,
  onSaved,
}: {
  reward?: RewardRow;
  merchants: MerchantOption[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = Boolean(reward);
  const [name, setName] = useState(reward?.name ?? "");
  const [description, setDescription] = useState(reward?.description ?? "");
  const [pointsCost, setPointsCost] = useState(
    reward ? String(reward.points_cost) : ""
  );
  const [stockTotal, setStockTotal] = useState(
    reward?.stock_total === null || reward?.stock_total === undefined
      ? ""
      : String(reward.stock_total)
  );
  const [perUserLimit, setPerUserLimit] = useState(
    reward?.per_user_limit === null || reward?.per_user_limit === undefined
      ? ""
      : String(reward.per_user_limit)
  );
  const [merchantId, setMerchantId] = useState(reward?.merchant_id ?? merchants[0]?.id ?? "");
  const [sortOrder, setSortOrder] = useState(String(reward?.sort_order ?? 0));
  const [status, setStatus] = useState<RewardStatus>(reward?.status ?? "active");
  const [imagePath, setImagePath] = useState<string | null>(reward?.image_path ?? null);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  /** 正在編輯的禮品若綁著已停用商戶，補一個選項，否則下拉會自動跳到第一間 */
  const options: MerchantOption[] = [...merchants];
  if (reward?.merchant && !options.some((m) => m.id === reward.merchant!.id)) {
    options.unshift(reward.merchant);
  }

  function toIntOrNull(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return Number(trimmed);
  }

  async function submit() {
    setError(null);
    setFields({});

    const payload: RewardInput & { action: string; id?: string } = {
      action: editing ? "update" : "create",
      id: reward?.id,
      name: name.trim(),
      description: description.trim(),
      points_cost: toIntOrNull(pointsCost),
      stock_total: toIntOrNull(stockTotal),
      per_user_limit: toIntOrNull(perUserLimit),
      merchant_id: merchantId,
      status,
      sort_order: toIntOrNull(sortOrder) ?? 0,
      image_path: imagePath,
    };

    // 先做一次前端檢查，避免白打一趟；真正權威仍是後端
    const local: Record<string, string> = {};
    if (!payload.name) local.name = "請填禮品名稱。";
    if (payload.points_cost === null || Number.isNaN(payload.points_cost) || payload.points_cost < 0) {
      local.points_cost = "請填 0 或以上的整數。";
    }
    if (!payload.merchant_id) local.merchant_id = "請選擇核銷商戶。";
    if (Object.keys(local).length > 0) {
      setFields(local);
      return;
    }

    setPending(true);
    try {
      const data = await postJson<{ message?: string }>("/api/admin/rewards", payload);
      onSaved(data.message ?? (editing ? "禮品已更新。" : "禮品已新增。"));
      onClose();
    } catch (err) {
      if (err instanceof FetchError) {
        setError(err.message);
        if (err.fields) setFields(err.fields);
      } else {
        setError("網路錯誤，請稍後再試。");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminModal
      title={editing ? `編輯禮品：${reward?.name}` : "新增禮品"}
      description="積分價與庫存由伺服器再驗一次；留空的庫存代表不限量。"
      onClose={() => {
        if (!pending) onClose();
      }}
      dismissible={!pending}
      width="max-w-2xl"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending} className="btn-base btn-ghost">
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={pending}
            className="btn-base btn-cobalt"
          >
            {pending ? (
              <>
                <Loader2 size={16} className="animate-spin" /> 儲存中…
              </>
            ) : (
              <>
                <Save size={16} /> {editing ? "儲存變更" : "新增禮品"}
              </>
            )}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <AdminError message={error} onDismiss={() => setError(null)} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="禮品名稱" htmlFor="reward-name" error={fields.name} className="sm:col-span-2">
            <input
              id="reward-name"
              className="field"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：MSW 運動毛巾"
              data-autofocus
            />
          </Field>

          <Field
            label="說明"
            htmlFor="reward-desc"
            hint="會員在兌換頁看到的補充說明，可留空。"
            error={fields.description}
            className="sm:col-span-2"
          >
            <textarea
              id="reward-desc"
              className="field min-h-20"
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="尺寸、材質、領取地點等"
            />
          </Field>

          <Field label="積分價" htmlFor="reward-cost" error={fields.points_cost}>
            <input
              id="reward-cost"
              className="field"
              inputMode="numeric"
              value={pointsCost}
              onChange={(event) => setPointsCost(event.target.value)}
              placeholder="例如 500"
            />
          </Field>

          <Field
            label="總庫存"
            htmlFor="reward-stock"
            hint="留空＝不限量（電子券）。已兌換的數量不會因調低總量而消失。"
            error={fields.stock_total}
          >
            <input
              id="reward-stock"
              className="field"
              inputMode="numeric"
              value={stockTotal}
              onChange={(event) => setStockTotal(event.target.value)}
              placeholder="留空＝不限量"
            />
          </Field>

          <Field
            label="每人上限"
            htmlFor="reward-limit"
            hint="留空＝不限。只計待審批／待領取／已完成。"
            error={fields.per_user_limit}
          >
            <input
              id="reward-limit"
              className="field"
              inputMode="numeric"
              value={perUserLimit}
              onChange={(event) => setPerUserLimit(event.target.value)}
              placeholder="留空＝不限"
            />
          </Field>

          <Field label="核銷商戶" htmlFor="reward-merchant" error={fields.merchant_id}>
            <select
              id="reward-merchant"
              className="field"
              value={merchantId}
              onChange={(event) => setMerchantId(event.target.value)}
            >
              <option value="">請選擇商戶</option>
              {options.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="排序"
            htmlFor="reward-sort"
            hint="數字越小越前；同分再依建立時間新到舊。"
            error={fields.sort_order}
          >
            <input
              id="reward-sort"
              className="field"
              inputMode="numeric"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
            />
          </Field>

          <Field label="狀態" htmlFor="reward-status" error={fields.status}>
            <select
              id="reward-status"
              className="field"
              value={status}
              onChange={(event) => setStatus(event.target.value as RewardStatus)}
            >
              <option value="active">上架（會員可見、可兌換）</option>
              <option value="inactive">下架（會員看不到）</option>
            </select>
          </Field>

          <div className="sm:col-span-2">
            <Field
              label="禮品圖片"
              hint="未上傳也可以儲存，列表會顯示「未設定圖片」。"
              error={fields.image_path}
            >
              <AssetUploader
                kind="reward"
                aspect="1/1"
                value={imagePath}
                onChange={setImagePath}
                disabled={pending}
              />
            </Field>
          </div>
        </div>
      </div>
    </AdminModal>
  );
}
