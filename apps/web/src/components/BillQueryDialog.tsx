"use client";

import { useEffect, useState } from "react";
import { formatHkd } from "@hkharp/domain/money";
import { ReceiptPreview, type ReceiptDetail } from "@/components/ReceiptPreview";

interface BillSummary {
  invoiceNo: string;
  docType: string;
  status: string;
  paymentStatus: string;
  businessDate: string;
  customerName: string;
  netAmountHkd: number;
  balanceDueHkd: number;
  issuedAtIso: string;
  deliveryStatus: string | null;
}

type QueryTab = "today" | "held" | "office" | "unprocessed";

const TABS: Array<{ id: QueryTab; label: string }> = [
  { id: "today", label: "今日銷售" },
  { id: "held", label: "暫停單" },
  { id: "office", label: "其他交易" },
  { id: "unprocessed", label: "未處理單" },
];

const button = "border border-[#7f9db9] bg-[#f0f0f0] px-4 py-1 text-[12px] text-black hover:bg-[#e5e1d5] disabled:cursor-not-allowed disabled:opacity-40";

export function BillQueryDialog({
  onClose,
  onLoad,
}: {
  onClose: () => void;
  onLoad: (detail: ReceiptDetail, action: "modify" | "reorder") => void;
}) {
  const [tab, setTab] = useState<QueryTab>("today");
  const [items, setItems] = useState<BillSummary[]>([]);
  const [selectedNo, setSelectedNo] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("查單取消");
  const [managerPin, setManagerPin] = useState("");
  const [busy, setBusy] = useState(false);

  async function selectInvoice(invoiceNo: string) {
    setSelectedNo(invoiceNo);
    setDetail(null);
    setError("");
    try {
      const res = await fetch(`/api/bills/${encodeURIComponent(invoiceNo)}`);
      const data = (await res.json()) as ReceiptDetail & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "未能讀取單據");
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未能讀取單據");
    }
  }

  async function loadList() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/invoices?view=${tab}&limit=200`);
      const data = (await res.json()) as { invoices: BillSummary[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "未能讀取查單資料");
      setItems(data.invoices);
      const next = data.invoices.find((item) => item.invoiceNo === selectedNo) ?? data.invoices[0];
      if (next) await selectInvoice(next.invoiceNo);
      else {
        setSelectedNo(null);
        setDetail(null);
      }
    } catch (err) {
      setItems([]);
      setDetail(null);
      setError(err instanceof Error ? err.message : "未能讀取查單資料");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadList();
  }, [tab]);

  async function voidSelected() {
    if (!selectedNo) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/bills/${encodeURIComponent(selectedNo)}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: voidReason,
          managerPin: managerPin.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "取消單據失敗");
      setConfirmVoid(false);
      setManagerPin("");
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "取消單據失敗");
    } finally {
      setBusy(false);
    }
  }

  async function completeDelivery() {
    if (!selectedNo) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/bills/${encodeURIComponent(selectedNo)}/delivery`, { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "提貨確認失敗");
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提貨確認失敗");
    } finally {
      setBusy(false);
    }
  }

  const cancelled = detail?.bill.status === "cancelled" || detail?.bill.status === "sealed";

  return (
    <div className="absolute inset-0 z-30 bg-black/10 p-4" role="dialog" aria-modal="true" aria-label="查單">
      <div className="flex h-full w-full flex-col border border-[#808080] bg-[#f0f0f0] shadow-[4px_4px_8px_rgba(0,0,0,0.4)]">
        <div className="border-b border-[#d4d0c8] px-2 py-1 text-[12px] font-bold text-black">查單</div>
        <div className="flex border-b border-[#aca899] text-[12px]">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`border-r border-[#aca899] px-4 py-1 text-black ${tab === item.id ? "bg-white font-bold" : "bg-[#f0f0f0]"}`}
            >
              {item.label}
            </button>
          ))}
          <div className="ml-auto px-2 py-1 text-black">單據 [{items.length}]</div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 overflow-auto bg-white">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#e8eef5] text-left text-black">
                  <th className="px-2 py-1 font-normal">單號</th>
                  <th className="px-2 py-1 font-normal">日期</th>
                  <th className="px-2 py-1 font-normal">類型</th>
                  <th className="px-2 py-1 font-normal">會員</th>
                  <th className="px-2 py-1 font-normal">狀態</th>
                  <th className="px-2 py-1 text-right font-normal">金額</th>
                  <th className="px-2 py-1 text-right font-normal">餘額</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr
                    key={item.invoiceNo}
                    onClick={() => void selectInvoice(item.invoiceNo)}
                    className={`cursor-pointer border-b border-[#d4d0c8] ${selectedNo === item.invoiceNo ? "bg-[#316ac5] text-white" : index % 2 ? "bg-[#f4f7fa] text-black" : "bg-white text-black"}`}
                  >
                    <td className="px-2 py-1 font-mono">{item.invoiceNo}</td>
                    <td className="px-2 py-1">{item.businessDate}</td>
                    <td className="px-2 py-1">{item.docType}</td>
                    <td className="max-w-32 truncate px-2 py-1">{item.customerName}</td>
                    <td className="px-2 py-1">{item.status === "cancelled" ? "已取消" : item.status === "sealed" ? "已封存" : item.paymentStatus.toUpperCase()}</td>
                    <td className="px-2 py-1 text-right font-mono">{formatHkd(item.netAmountHkd)}</td>
                    <td className="px-2 py-1 text-right font-mono">{formatHkd(item.balanceDueHkd)}</td>
                  </tr>
                ))}
                {!loading && items.length === 0 ? <tr><td colSpan={7} className="px-2 py-12 text-center text-[#808080]">此分類暫無單據</td></tr> : null}
              </tbody>
            </table>
            {loading ? <div className="p-3 text-center text-[12px] text-black">讀取中…</div> : null}
          </div>
          <div className="min-h-0 overflow-auto border-l border-[#aca899] bg-[#d4d0c8] p-2">
            {detail ? <ReceiptPreview detail={detail} /> : <div className="p-8 text-center text-[12px] text-black">選擇單據以預覽收據</div>}
          </div>
        </div>
        {error ? <div className="border-t border-[#aca899] bg-[#ffffe1] px-2 py-1 text-[12px] text-[#c00000]">營運通訊息 - 050：{error}</div> : null}
        <div className="flex items-center gap-2 border-t border-[#aca899] p-2">
          <button type="button" className={button} disabled={!detail || cancelled || busy} onClick={() => setConfirmVoid(true)}>取消</button>
          <button type="button" className={button} disabled={!detail || cancelled} onClick={() => detail && onLoad(detail, "modify")}>修改</button>
          <button type="button" className={button} disabled={!detail || cancelled} onClick={() => detail && onLoad(detail, "reorder")}>加訂</button>
          <button type="button" className={button} disabled={!detail || cancelled || busy || detail?.bill.deliveryStatus === "delivered"} onClick={() => void completeDelivery()}>提貨</button>
          <button type="button" className={button} disabled={!detail} onClick={() => window.print()}>列印預覽</button>
          <div className="flex-1" />
          <button type="button" autoFocus className={`${button} bg-[#e1dfff] px-7`} onClick={onClose}>離開</button>
        </div>
      </div>
      {confirmVoid ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/20" role="alertdialog" aria-modal="true">
          <div className="w-[430px] border border-[#808080] bg-[#f0f0f0] p-3 shadow-xl">
            <div className="text-[13px] font-bold text-[#2e7ec2]">營運通訊息 - 051</div>
            <div className="mt-2 text-[13px] text-black">確定取消單據 {selectedNo}？此動作會回沖存貨及付款。</div>
            <label className="mt-3 block text-[12px] text-black">取消原因<input value={voidReason} onChange={(event) => setVoidReason(event.target.value)} className="mt-1 w-full border border-[#7f9db9] bg-white px-2 py-1" /></label>
            <label className="mt-2 block text-[12px] text-black">經理覆核密碼 (6位收銀密碼，非 L4+ 時填寫)<input type="password" inputMode="numeric" maxLength={6} value={managerPin} onChange={(event) => setManagerPin(event.target.value.replace(/\D/g, ""))} placeholder="L4+ 免填" className="mt-1 w-full border border-[#7f9db9] bg-white px-2 py-1 font-mono" /></label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={button} disabled={busy || !voidReason.trim()} onClick={() => void voidSelected()}>確定取消單</button>
              <button type="button" autoFocus className={`${button} bg-[#e1dfff]`} onClick={() => setConfirmVoid(false)}>離開</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
