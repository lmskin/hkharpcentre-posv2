"use client";

import { useEffect, useState } from "react";
import { formatHkd } from "@hkharp/domain/money";
import type { PosProduct } from "@/components/PosRegisterClient";

export type OfficeDocType =
  | "GOODS_RECEIPT"
  | "PURCHASE_RETURN"
  | "SALES_RETURN"
  | "STOCK_TRANSFER_OUT"
  | "STOCK_TRANSFER_IN"
  | "WRITE_OFF"
  | "STOCK_ADJUSTMENT"
  | "PETTY_PAYOUT";
interface OfficeLine { sku: string; nameZh: string; nameEn: string; categoryC1: number; quantity: number; unitPriceHkd: number; adjustmentDirection: 1 | -1 }
interface SupplierItem { id: number; legacyId: string; nameZh: string; nameEn: string }
const TYPES: Array<{ id: OfficeDocType; label: string; reference: string }> = [
  { id: "GOODS_RECEIPT", label: "到貨", reference: "供應商 / 來貨單號" },
  { id: "PURCHASE_RETURN", label: "退貨確認", reference: "供應商 / 退貨單號" },
  { id: "SALES_RETURN", label: "退貨", reference: "原銷售單號" },
  { id: "STOCK_TRANSFER_OUT", label: "轉出", reference: "目的地 / 轉倉單號" },
  { id: "STOCK_TRANSFER_IN", label: "轉入", reference: "來源分店 / 轉倉單號" },
  { id: "WRITE_OFF", label: "報銷", reference: "報銷原因 / 批核編號" },
  { id: "STOCK_ADJUSTMENT", label: "調整", reference: "調整原因 / 批核編號" },
  { id: "PETTY_PAYOUT", label: "Payout", reference: "付款原因 / 收款人" },
];
const input = "border border-[#7f9db9] bg-white px-2 py-1 text-[12px] text-black";
const button = "border border-[#7f9db9] bg-[#f0f0f0] px-4 py-1 text-[12px] text-black hover:bg-[#e5e1d5] disabled:cursor-not-allowed disabled:opacity-40";

export function OfficeTxnPanel({ initialType, products, onSearch, onClose }: { initialType: OfficeDocType; products: PosProduct[]; onSearch: (query: string) => Promise<void>; onClose: () => void }) {
  const [docType, setDocType] = useState<OfficeDocType>(initialType);
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<OfficeLine[]>([]);
  const [manual, setManual] = useState({ sku: "", name: "", quantity: "1", price: "0" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [completedNo, setCompletedNo] = useState("");
  const type = TYPES.find((item) => item.id === docType)!;

  useEffect(() => {
    fetch("/api/suppliers?limit=100")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { suppliers?: SupplierItem[] } | null) => {
        if (Array.isArray(data?.suppliers)) setSuppliers(data.suppliers);
      })
      .catch(() => {});
  }, []);

  function addProduct(product: PosProduct) {
    setCompletedNo("");
    setLines((current) => {
      const existing = current.find((line) => line.sku === product.sku);
      if (existing) return current.map((line) => line.sku === product.sku ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { sku: product.sku, nameZh: product.nameZh, nameEn: product.nameEn, categoryC1: product.categoryC1, quantity: 1, unitPriceHkd: product.unitPriceHkd, adjustmentDirection: 1 }];
    });
  }

  function addManual() {
    if (!manual.sku.trim() || !manual.name.trim() || Number(manual.quantity) <= 0 || Number(manual.price) < 0) return;
    setCompletedNo("");
    setLines((current) => [...current, { sku: manual.sku.trim(), nameZh: manual.name.trim(), nameEn: manual.name.trim(), categoryC1: 0, quantity: Number(manual.quantity), unitPriceHkd: Number(manual.price), adjustmentDirection: 1 }]);
    setManual({ sku: "", name: "", quantity: "1", price: "0" });
  }

  function updateLine(index: number, patch: Partial<OfficeLine>) {
    setCompletedNo("");
    setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  }

  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceHkd, 0);
  const valid = lines.length > 0 && lines.every((line) => line.sku && line.nameZh && line.quantity > 0 && line.unitPriceHkd >= 0);

  async function submit() {
    if (!valid || completedNo) return;
    setBusy(true); setMessage("");
    try {
      const supplierLegacyId =
        docType === "GOODS_RECEIPT" || docType === "PURCHASE_RETURN" ? selectedSupplier || undefined : undefined;
      const res = await fetch("/api/office-txn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientIdempotencyKey: `office-${crypto.randomUUID()}`,
          docType,
          supplierLegacyId,
          reference,
          notes,
          lines,
        }),
      });
      const data = (await res.json()) as { invoiceNo?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "其他交易儲存失敗");
      setCompletedNo(data.invoiceNo ?? ""); setMessage(`單據 ${data.invoiceNo} 已完成並落庫`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "其他交易儲存失敗");
    } finally { setBusy(false); }
  }

  return (
    <div className="absolute inset-0 z-20 bg-black/10 p-3" role="dialog" aria-modal="true" aria-label="其他交易">
      <div className="flex h-full flex-col border border-[#808080] bg-[#f0f0f0] shadow-[4px_4px_8px_rgba(0,0,0,0.4)]">
        <div className="border-b border-[#d4d0c8] px-2 py-1 text-[12px] font-bold text-black">其他交易 - {type.label}</div>
        <div className="flex border-b border-[#aca899]">{TYPES.map((item) => <button key={item.id} type="button" onClick={() => { setDocType(item.id); setCompletedNo(""); }} className={`border-r border-[#aca899] px-5 py-1 text-[12px] ${docType === item.id ? "bg-white font-bold text-black" : "bg-[#f0f0f0] text-black"}`}>{item.label}</button>)}</div>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#aca899] p-2 text-[12px] text-black">
          {docType === "GOODS_RECEIPT" || docType === "PURCHASE_RETURN" ? (
            <label>
              供應商
              <select
                aria-label="供應商"
                value={selectedSupplier}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedSupplier(val);
                  const sup = suppliers.find((s) => s.legacyId === val);
                  if (sup) setReference(`${sup.legacyId} - ${sup.nameZh || sup.nameEn}`);
                }}
                className={`${input} ml-1 w-48`}
              >
                <option value="">-- 選擇供應商 ({suppliers.length}) --</option>
                {suppliers.map((s) => {
                  const label = `${s.legacyId} - ${s.nameZh || s.nameEn}`;
                  return (
                    <option key={s.id} value={s.legacyId}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : null}
          <label>{type.reference}<input value={reference} onChange={(event) => setReference(event.target.value)} className={`${input} ml-2 w-56`} /></label>
          <label>備註<input value={notes} onChange={(event) => setNotes(event.target.value)} className={`${input} ml-2 w-48`} /></label>
          <span className="ml-auto font-mono text-[16px]">總計 {formatHkd(total)}</span>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_330px]">
          <div className="min-h-0 overflow-auto bg-[#dfe7f0]">
            <table className="w-full border-collapse text-[12px]"><thead className="sticky top-0"><tr className="bg-[#e8eef5] text-left text-black"><th className="px-2 py-1 font-normal">條碼</th><th className="px-2 py-1 font-normal">貨品 / 說明</th><th className="px-2 py-1 text-right font-normal">數量</th>{docType === "STOCK_ADJUSTMENT" ? <th className="px-2 py-1 font-normal">方向</th> : null}<th className="px-2 py-1 text-right font-normal">{docType === "GOODS_RECEIPT" ? "單位成本" : "單價"}</th><th className="px-2 py-1 text-right font-normal">金額</th><th className="px-2 py-1" /></tr></thead><tbody>{lines.map((line, index) => <tr key={`${line.sku}-${index}`} className={index % 2 ? "bg-[#e9eff6] text-black" : "bg-[#dfe7f0] text-black"}><td className="px-2 py-1 font-mono">{line.sku}</td><td className="px-2 py-1">{line.nameZh}</td><td className="px-1 py-0.5 text-right"><input type="number" min="0.0001" step="0.01" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} className={`${input} w-20 text-right`} /></td>{docType === "STOCK_ADJUSTMENT" ? <td className="px-1 py-0.5"><select value={line.adjustmentDirection} onChange={(event) => updateLine(index, { adjustmentDirection: Number(event.target.value) as 1 | -1 })} className={input}><option value={1}>增加</option><option value={-1}>減少</option></select></td> : null}<td className="px-1 py-0.5 text-right"><input type="number" min="0" step="0.01" value={line.unitPriceHkd} onChange={(event) => updateLine(index, { unitPriceHkd: Number(event.target.value) })} className={`${input} w-24 text-right`} /></td><td className="px-2 py-1 text-right font-mono">{formatHkd(line.quantity * line.unitPriceHkd)}</td><td className="px-1 py-0.5"><button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className={button}>移除</button></td></tr>)}</tbody></table>
            {lines.length === 0 ? <div className="p-10 text-center text-[12px] text-[#666]">由右方貨品清單加入項目</div> : null}
          </div>
          <div className="flex min-h-0 flex-col border-l border-[#aca899] bg-white">
            <div className="border-b border-[#aca899] bg-[#e8eef5] p-2 text-[12px] text-black"><input value={query} onChange={(event) => { setQuery(event.target.value); void onSearch(event.target.value); }} className={`${input} w-full`} placeholder="搜尋條碼 / 貨品" /></div>
            <div className="min-h-0 flex-1 overflow-auto">{products.map((product) => <button key={product.sku} type="button" onClick={() => addProduct(product)} className="flex w-full justify-between gap-2 border-b border-[#e0e0e0] px-2 py-1 text-left text-[11px] text-black hover:bg-[#316ac5] hover:text-white"><span className="font-mono">{product.sku}</span><span className="flex-1 truncate">{product.nameZh || product.nameEn}</span><span>{formatHkd(product.unitPriceHkd)}</span></button>)}</div>
            <div className="border-t border-[#aca899] bg-[#f0f0f0] p-2 text-[11px] text-black"><div className="mb-1 font-bold">人手入行</div><div className="grid grid-cols-2 gap-1"><input value={manual.sku} onChange={(event) => setManual((current) => ({ ...current, sku: event.target.value }))} className={input} placeholder="條碼 / 編號" /><input value={manual.name} onChange={(event) => setManual((current) => ({ ...current, name: event.target.value }))} className={input} placeholder="說明" /><input type="number" value={manual.quantity} onChange={(event) => setManual((current) => ({ ...current, quantity: event.target.value }))} className={input} placeholder="數量" /><input type="number" value={manual.price} onChange={(event) => setManual((current) => ({ ...current, price: event.target.value }))} className={input} placeholder="單價" /></div><button type="button" onClick={addManual} className={`${button} mt-1 w-full`}>加入</button></div>
          </div>
        </div>
        {message ? <div className={`bg-[#ffffe1] px-2 py-1 text-[12px] ${completedNo ? "text-[#0a7a2f]" : "text-[#c00000]"}`}>營運通訊息 - {completedNo ? "000" : "054"}：{message}</div> : null}
        <div className="flex items-center gap-2 border-t border-[#aca899] p-2"><button type="button" disabled={!valid || busy || Boolean(completedNo)} onClick={() => void submit()} className={`${button} px-7`}>{busy ? "儲存中…" : "完成"}</button>{completedNo ? <button type="button" className={button} onClick={() => { setLines([]); setReference(""); setNotes(""); setCompletedNo(""); setMessage(""); }}>開新單</button> : null}<span className="text-[11px] text-[#666]">未完成入行前，完成鍵保持置灰。</span><button type="button" autoFocus onClick={onClose} className={`${button} ml-auto bg-[#e1dfff] px-7`}>離開</button></div>
      </div>
    </div>
  );
}
