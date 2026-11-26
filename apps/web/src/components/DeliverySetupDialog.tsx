"use client";

import { useState } from "react";

export interface DeliveryDraftInfo {
  enabled: boolean;
  scheduledDate: string;
  recipientPhone: string;
  deliveryAddress: string;
  remarks: string;
}

export function getTodayHkt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date());
}

export function DeliverySetupDialog({
  invoiceNo,
  initialInfo,
  customerPhone,
  customerAddress,
  onClose,
  onSaved,
}: {
  invoiceNo?: string | null;
  initialInfo: DeliveryDraftInfo;
  customerPhone?: string;
  customerAddress?: string;
  onClose: () => void;
  onSaved: (nextInfo: DeliveryDraftInfo) => void;
}) {
  const [enabled, setEnabled] = useState(initialInfo.enabled);
  const [scheduledDate, setScheduledDate] = useState(initialInfo.scheduledDate || getTodayHkt());
  const [recipientPhone, setRecipientPhone] = useState(
    initialInfo.recipientPhone || customerPhone || "",
  );
  const [deliveryAddress, setDeliveryAddress] = useState(
    initialInfo.deliveryAddress || customerAddress || "",
  );
  const [remarks, setRemarks] = useState(initialInfo.remarks || "");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextInfo: DeliveryDraftInfo = {
      enabled,
      scheduledDate: scheduledDate.trim(),
      recipientPhone: recipientPhone.trim(),
      deliveryAddress: deliveryAddress.trim(),
      remarks: remarks.trim(),
    };
    if (invoiceNo && enabled) {
      setBusy(true);
      setErrorMsg("");
      try {
        const res = await fetch(`/api/bills/${encodeURIComponent(invoiceNo)}/delivery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update_info",
            scheduledDate: nextInfo.scheduledDate || undefined,
            recipientPhone: nextInfo.recipientPhone,
            deliveryAddress: nextInfo.deliveryAddress,
            remarks: nextInfo.remarks,
          }),
        });
        const body = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? "儲存送貨資料失敗");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "儲存送貨資料失敗");
        setBusy(false);
        return;
      } finally {
        setBusy(false);
      }
    }
    onSaved(nextInfo);
  }

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/35"
      role="dialog"
      aria-modal="true"
      aria-label="送貨設定"
      onKeyDown={(e) => {
        if (e.key === "Escape") e.preventDefault();
      }}
    >
      <div className="w-[480px] max-w-[95vw] border-2 border-[#0a246a] bg-[#f0f0f0] text-xs text-black shadow-2xl">
        <div className="flex items-center justify-between bg-[#0a246a] px-3 py-1 font-bold text-white">
          <span>送貨設定 / 送貨單資料 {invoiceNo ? `· ${invoiceNo}` : ""}</span>
          <button type="button" onClick={onClose} className="px-1 hover:text-[#ffe6a0]">
            ✕
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 p-4">
          {!invoiceNo ? (
            <div className="flex items-center gap-4 border border-[#aca899] bg-white px-3 py-1.5">
              <span className="font-bold">取貨方式：</span>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="deliveryMode"
                  checked={!enabled}
                  onChange={() => setEnabled(false)}
                />
                <span>自取</span>
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="deliveryMode"
                  checked={enabled}
                  onChange={() => setEnabled(true)}
                />
                <span>送貨</span>
              </label>
            </div>
          ) : null}

          <label className="grid grid-cols-[96px_1fr] items-center gap-2">
            <span className="font-bold">送貨日期</span>
            <input
              name="deliveryScheduledDate"
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="border border-[#7f9db9] bg-white px-2 py-1 font-mono"
            />
          </label>

          <label className="grid grid-cols-[96px_1fr] items-center gap-2">
            <span className="font-bold">收件電話</span>
            <input
              name="deliveryRecipientPhone"
              type="text"
              maxLength={60}
              placeholder="收件人或琴行聯絡電話"
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
              className="border border-[#7f9db9] bg-white px-2 py-1 font-mono"
            />
          </label>

          <label className="grid grid-cols-[96px_1fr] items-start gap-2">
            <span className="pt-1 font-bold">送貨地址</span>
            <div className="space-y-1">
              <textarea
                name="deliveryAddress"
                rows={3}
                maxLength={500}
                placeholder="送貨地址（可多行，例如琴行客戶收件地址）"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                className="w-full border border-[#7f9db9] bg-white px-2 py-1"
              />
              {(customerPhone || customerAddress) ? (
                <button
                  type="button"
                  onClick={() => {
                    if (customerPhone) setRecipientPhone(customerPhone);
                    if (customerAddress) setDeliveryAddress(customerAddress);
                  }}
                  className="border border-[#aca899] bg-[#e6e4dc] px-2 py-0.5 text-[11px] hover:bg-white"
                >
                  套用會員電話及地址
                </button>
              ) : null}
            </div>
          </label>

          <label className="grid grid-cols-[96px_1fr] items-center gap-2">
            <span className="font-bold">送貨備註</span>
            <input
              name="deliveryRemarks"
              type="text"
              maxLength={255}
              placeholder="例如：提前致電師傅 / 放管理處"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="border border-[#7f9db9] bg-white px-2 py-1"
            />
          </label>

          {errorMsg ? (
            <div className="border border-red-400 bg-red-50 px-2 py-1 text-[#c00000]">{errorMsg}</div>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-[#d4d0c8] pt-2">
            <button
              type="submit"
              disabled={busy}
              className="border border-[#0a246a] bg-[#dbeafe] px-5 py-1 font-bold text-[#0a246a] hover:bg-white disabled:opacity-40"
            >
              {busy ? "儲存中…" : "儲存送貨設定"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="border border-[#808080] bg-[#e1dfff] px-5 py-1 font-bold hover:bg-white"
            >
              離開
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
