"use client";

import { useCallback, useEffect, useState } from "react";
import type { TenderCode } from "@hkharp/contracts";
import { formatHkd } from "@hkharp/domain/money";
import type { ReceiptDetail } from "@/components/ReceiptPreview";

const DEPOSIT_TENDERS: ReadonlyArray<{ code: TenderCode; label: string }> = [
  { code: "CASH", label: "現金" },
  { code: "UNIONPAY", label: "銀聯" },
  { code: "OCTOPUS", label: "八達通" },
  { code: "BANK_XFER", label: "Bank Transfer" },
  { code: "VISA", label: "Visa" },
  { code: "AMEX", label: "AE" },
  { code: "MASTERCARD", label: "MasterCard" },
  { code: "CHEQUE", label: "Cheque" },
];

export function DepositPaymentDialog({
  invoiceNo,
  initialDetail,
  onClose,
  onUpdated,
}: {
  invoiceNo: string;
  initialDetail?: ReceiptDetail | null;
  onClose: () => void;
  onUpdated?: (detail: ReceiptDetail) => void;
}) {
  const [detail, setDetail] = useState<ReceiptDetail | null>(initialDetail ?? null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [editorMode, setEditorMode] = useState<"add" | "edit">("add");
  const [tenderCode, setTenderCode] = useState<TenderCode>("CASH");
  const [amountInput, setAmountInput] = useState("");
  const [remarksInput, setRemarksInput] = useState("");
  const [approvalCode, setApprovalCode] = useState("");
  const [cardLast4, setCardLast4] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const refreshDetail = useCallback(async () => {
    const res = await fetch(`/api/bills/${encodeURIComponent(invoiceNo)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as ReceiptDetail;
    setDetail(data);
    onUpdated?.(data);
    return data;
  }, [invoiceNo, onUpdated]);

  useEffect(() => {
    void refreshDetail();
  }, [refreshDetail]);

  const payments = detail?.payments ?? [];
  const selectedPayment = payments[selectedIdx] ?? null;

  function switchToAdd() {
    setEditorMode("add");
    setAmountInput("");
    setRemarksInput("");
    setApprovalCode("");
    setCardLast4("");
    setErrorMsg("");
  }

  function switchToEdit() {
    if (!selectedPayment) {
      setErrorMsg("請先選擇一筆訂金紀錄");
      return;
    }
    setEditorMode("edit");
    setTenderCode(selectedPayment.tenderCode as TenderCode);
    setAmountInput(String(selectedPayment.amountHkd));
    setRemarksInput(selectedPayment.remarks ?? selectedPayment.referenceNo ?? "");
    setApprovalCode(selectedPayment.approvalCode ?? "");
    setCardLast4(selectedPayment.cardLast4 ?? "");
    setErrorMsg("");
  }

  async function handleConfirmDeposit(overrideAmount?: number) {
    if (!detail) return;
    const amt = overrideAmount ?? Number(amountInput);
    if (!Number.isFinite(amt) || amt <= 0) {
      setErrorMsg("請輸入有效金額");
      return;
    }
    setBusy(true);
    setErrorMsg("");
    setStatusMsg("");
    try {
      if (editorMode === "edit" && selectedPayment?.id) {
        const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceNo)}/payments`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentId: selectedPayment.id,
            tenderCode,
            amountHkd: Number(amt.toFixed(2)),
            remarks: remarksInput.trim(),
            approvalCode: approvalCode.trim() || undefined,
            cardLast4: cardLast4.length === 4 ? cardLast4 : undefined,
          }),
        });
        const body = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? "修改訂金失敗");
        setStatusMsg(`已更新訂金：${tenderCode} ${formatHkd(amt)}`);
      } else {
        const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceNo)}/payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientIdempotencyKey: `dep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            tenderCode,
            amountHkd: Number(amt.toFixed(2)),
            approvalCode: approvalCode.trim() || undefined,
            cardLast4: cardLast4.length === 4 ? cardLast4 : undefined,
            remarks: remarksInput.trim() || "Additional deposit",
          }),
        });
        const body = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? "新增訂金失敗");
        setStatusMsg(`已記錄訂金：${tenderCode} ${formatHkd(amt)}`);
      }
      await refreshDetail();
      switchToAdd();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "操作失敗");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelSelectedDeposit() {
    if (!selectedPayment?.id) {
      setErrorMsg("請先選擇要取消的訂金紀錄");
      return;
    }
    setBusy(true);
    setErrorMsg("");
    setStatusMsg("");
    try {
      const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceNo)}/payments`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId: selectedPayment.id,
          reason: "Cancelled via POS 取消訂",
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "取消訂金失敗");
      setStatusMsg(`已取消訂金 ${selectedPayment.tenderCode} ${formatHkd(selectedPayment.amountHkd)}`);
      setSelectedIdx(0);
      await refreshDetail();
      switchToAdd();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "取消訂金失敗");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeliveryStatus(action: "receive" | "reset_pending") {
    setBusy(true);
    setErrorMsg("");
    setStatusMsg("");
    try {
      const res = await fetch(`/api/bills/${encodeURIComponent(invoiceNo)}/delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "更新提貨狀態失敗");
      setStatusMsg(action === "receive" ? "已標記提貨完成" : "已還原為未提貨狀態");
      await refreshDetail();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "更新提貨狀態失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="付款 / 落訂管理"
      onKeyDown={(e) => {
        if (e.key === "Escape") e.preventDefault();
      }}
    >
      <div className="flex w-[860px] max-w-[96vw] flex-col border-2 border-[#0a246a] bg-[#ece9d8] text-xs text-black shadow-2xl">
        {/* Top bar matching image9 */}
        <div className="flex items-center justify-between border-b border-[#808080] bg-[#d4d0c8] px-3 py-1.5">
          <div className="flex items-center gap-4 text-[13px] font-bold">
            <span className="text-[#8b0000]">零售 / 付款</span>
            <span className="font-mono text-[#a02000]">{invoiceNo}</span>
            <span className="text-[#a04000]">
              {detail?.bill.balanceDueHkd && detail.bill.balanceDueHkd > 0 ? "落訂" : "已結清"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="border border-[#aca899] bg-[#ffffe1] px-2 py-0.5 font-mono">
              已收記錄：{payments.length} 筆
            </span>
            <button
              type="button"
              onClick={onClose}
              className="border border-[#808080] bg-[#e1dfff] px-4 py-1 font-bold hover:bg-white"
            >
              離開
            </button>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-2 p-2.5">
          {/* Left: Payment history grid + 取消訂 ↑ ↓ 改訂 落訂/加訂 */}
          <div className="col-span-5 flex flex-col border border-[#808080] bg-white">
            <div className="min-h-[250px] flex-1 overflow-auto bg-[#fffff8]">
              <table className="w-full border-collapse text-left text-[11px]">
                <thead className="sticky top-0 bg-[#ece9d8] text-black shadow-[0_1px_0_#aca899]">
                  <tr>
                    <th className="border-r border-[#c8c8c8] px-1.5 py-1">日期</th>
                    <th className="border-r border-[#c8c8c8] px-1.5 py-1">職員</th>
                    <th className="border-r border-[#c8c8c8] px-1.5 py-1">方法</th>
                    <th className="px-1.5 py-1 text-right">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-[#666]">
                        暫無訂金／收款紀錄
                      </td>
                    </tr>
                  ) : (
                    payments.map((p, idx) => (
                      <tr
                        key={p.id ?? `${p.tenderCode}-${idx}`}
                        onClick={() => setSelectedIdx(idx)}
                        className={`cursor-pointer border-b border-[#eee] ${
                          idx === selectedIdx ? "bg-[#316ac5] text-white" : "hover:bg-[#eef4ff]"
                        }`}
                        title={p.remarks || p.referenceNo || ""}
                      >
                        <td className="px-1.5 py-1 font-mono">{p.paidAtIso.slice(5, 10).replace("-", "/")}</td>
                        <td className="px-1.5 py-1">{p.staffName || "-"}</td>
                        <td className="px-1.5 py-1">{p.payMethodNameZh || p.tenderCode}</td>
                        <td className="px-1.5 py-1 text-right font-mono font-bold">{formatHkd(p.amountHkd)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-5 gap-1 border-t border-[#808080] bg-[#d4d0c8] p-1">
              <button
                type="button"
                disabled={busy || !selectedPayment}
                onClick={() => void handleCancelSelectedDeposit()}
                className="flex flex-col items-center border border-[#808080] bg-[#ece9d8] py-1.5 text-[11px] font-bold text-[#c00000] hover:bg-white disabled:opacity-40"
              >
                <span aria-hidden="true">✕</span>
                <span>取消訂</span>
              </button>
              <button
                type="button"
                disabled={payments.length === 0}
                onClick={() => setSelectedIdx((i) => Math.max(0, i - 1))}
                className="border border-[#808080] bg-[#ece9d8] py-1.5 font-bold hover:bg-white disabled:opacity-40"
                aria-label="上一筆訂金"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={payments.length === 0}
                onClick={() => setSelectedIdx((i) => Math.min(payments.length - 1, i + 1))}
                className="border border-[#808080] bg-[#ece9d8] py-1.5 font-bold hover:bg-white disabled:opacity-40"
                aria-label="下一筆訂金"
              >
                ↓
              </button>
              <button
                type="button"
                disabled={busy || !selectedPayment}
                onClick={switchToEdit}
                className={`border border-[#808080] py-1.5 text-[11px] font-bold hover:bg-white disabled:opacity-40 ${
                  editorMode === "edit" ? "bg-[#ffe6a0] text-[#0a246a]" : "bg-[#ece9d8]"
                }`}
              >
                改訂
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={switchToAdd}
                className={`border border-[#808080] py-1.5 text-[11px] font-bold hover:bg-white disabled:opacity-40 ${
                  editorMode === "add" ? "bg-[#d1fae5] text-[#065f46]" : "bg-[#ece9d8]"
                }`}
              >
                落訂/加訂
              </button>
            </div>
          </div>

          {/* Center: Totals + editor + 4x3 keypad */}
          <div className="col-span-4 flex flex-col gap-2">
            <div className="space-y-1 border border-[#808080] bg-[#d4d0c8] p-2">
              <div className="flex items-center justify-between">
                <span>總數</span>
                <span className="w-28 border border-[#aca899] bg-[#e8e8e8] px-2 py-0.5 text-right font-mono font-bold">
                  {detail ? formatHkd(detail.bill.netAmountHkd) : "-"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>已付</span>
                <span
                  data-testid="deposit-dlg-paid"
                  className="w-28 border border-[#aca899] bg-[#e8e8e8] px-2 py-0.5 text-right font-mono font-bold text-[#0a7a2f]"
                >
                  {detail ? formatHkd(detail.bill.paidAmountHkd) : "-"}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-[#aca899] pt-1">
                <span>尚欠</span>
                <span
                  data-testid="deposit-dlg-balance"
                  className="w-28 border border-[#aca899] bg-white px-2 py-0.5 text-right font-mono font-bold text-[#c00000]"
                >
                  {detail ? formatHkd(detail.bill.balanceDueHkd) : "-"}
                </span>
              </div>
            </div>

            <fieldset className="space-y-1.5 border border-[#808080] p-2">
              <legend className="px-1 font-bold text-[#8b0000]">
                {editorMode === "edit" ? `改訂 (#${selectedPayment?.id ?? ""})` : "落訂 / 加訂"}
              </legend>
              <label className="flex items-center justify-between gap-2">
                <span className="font-bold text-[#003399]">金額</span>
                <input
                  name="depositEditAmount"
                  type="text"
                  inputMode="decimal"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="輸入訂金金額"
                  className="w-36 border border-[#7f9db9] bg-white px-2 py-1 text-right font-mono text-[15px] font-bold text-[#003399]"
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="font-bold text-[#003399]">附註</span>
                <input
                  name="depositEditRemarks"
                  type="text"
                  value={remarksInput}
                  onChange={(e) => setRemarksInput(e.target.value)}
                  placeholder="例如：paid on 26/11"
                  className="w-36 border border-[#7f9db9] bg-white px-2 py-0.5 text-[11px]"
                />
              </label>
              <div className="text-[11px] text-[#444]">
                已選方式：<strong className="text-[#0a246a]">{DEPOSIT_TENDERS.find((t) => t.code === tenderCode)?.label ?? tenderCode}</strong>
              </div>
            </fieldset>

            {/* 4x4 numeric & deposit action pad */}
            <div className="grid grid-cols-4 gap-1">
              {["7", "8", "9"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAmountInput((p) => (p + k).slice(0, 12))}
                  className="border border-[#808080] bg-white py-2 font-mono text-[15px] font-bold hover:bg-[#eef4ff]"
                >
                  {k}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setAmountInput((p) => p.slice(0, -1))}
                className="border border-[#808080] bg-[#ece9d8] py-2 font-mono font-bold hover:bg-white"
              >
                ←
              </button>

              {["4", "5", "6"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAmountInput((p) => (p + k).slice(0, 12))}
                  className="border border-[#808080] bg-white py-2 font-mono text-[15px] font-bold hover:bg-[#eef4ff]"
                >
                  {k}
                </button>
              ))}
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDeliveryStatus("reset_pending")}
                className="border border-[#808080] bg-[#ece9d8] py-1 text-[10px] font-bold hover:bg-white disabled:opacity-40"
              >
                還原未提
              </button>

              {["1", "2", "3"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAmountInput((p) => (p + k).slice(0, 12))}
                  className="border border-[#808080] bg-white py-2 font-mono text-[15px] font-bold hover:bg-[#eef4ff]"
                >
                  {k}
                </button>
              ))}
              <button
                type="button"
                disabled={busy || (!detail || (editorMode === "add" && detail.bill.balanceDueHkd <= 0.005))}
                onClick={() => void handleConfirmDeposit()}
                className="border border-[#065f46] bg-[#d1fae5] py-1 text-[10px] font-bold text-[#065f46] hover:bg-[#a7f3d0] disabled:opacity-40"
              >
                {editorMode === "edit" ? "儲存改訂" : "確定訂金"}
              </button>

              <button
                type="button"
                onClick={() => setAmountInput((p) => (p + "0").slice(0, 12))}
                className="border border-[#808080] bg-white py-2 font-mono text-[15px] font-bold hover:bg-[#eef4ff]"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => setAmountInput((p) => (p.includes(".") ? p : `${p || "0"}.`))}
                className="border border-[#808080] bg-white py-2 font-mono text-[15px] font-bold hover:bg-[#eef4ff]"
              >
                .
              </button>
              <button
                type="button"
                onClick={() => setAmountInput("")}
                className="border border-[#808080] bg-[#ece9d8] py-2 font-mono text-[15px] font-bold hover:bg-white"
              >
                C
              </button>
              <button
                type="button"
                disabled={busy || !detail || detail.bill.balanceDueHkd <= 0.005}
                onClick={() => {
                  if (!detail) return;
                  setEditorMode("add");
                  setAmountInput(String(detail.bill.balanceDueHkd));
                  void handleConfirmDeposit(detail.bill.balanceDueHkd);
                }}
                className="border border-[#0a246a] bg-[#dbeafe] py-1 text-[10px] font-bold text-[#0a246a] hover:bg-[#bfdbfe] disabled:opacity-40"
              >
                尾數付款
              </button>
            </div>
          </div>

          {/* Right: 2-col Tender Grid + 提貨 */}
          <div className="col-span-3 flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-1">
              {DEPOSIT_TENDERS.map((t) => (
                <button
                  key={t.code}
                  type="button"
                  onClick={() => setTenderCode(t.code)}
                  className={`border px-2 py-2.5 text-[11px] font-bold ${
                    tenderCode === t.code
                      ? "border-[#0a246a] bg-[#316ac5] text-white"
                      : "border-[#808080] bg-[#ece9d8] text-black hover:bg-white"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDeliveryStatus("receive")}
              className="mt-auto border border-[#065f46] bg-[#d1fae5] py-3 text-[13px] font-bold text-[#065f46] hover:bg-[#a7f3d0] disabled:opacity-40"
            >
              ✓ 提貨 (完成交付)
            </button>
          </div>
        </div>

        {(errorMsg || statusMsg) ? (
          <div
            className={`border-t px-3 py-1.5 font-bold ${
              errorMsg ? "border-red-300 bg-red-50 text-[#c00000]" : "border-emerald-300 bg-emerald-50 text-[#065f46]"
            }`}
          >
            {errorMsg || statusMsg}
          </div>
        ) : null}
      </div>
    </div>
  );
}
