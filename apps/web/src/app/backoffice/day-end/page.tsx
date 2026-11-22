"use client";

import { useEffect, useState } from "react";
import { formatHkd } from "@hkharp/domain/money";

interface DayEndPreview {
  businessDate: string;
  openingFloatHkd?: number;
  billCount: number;
  issuedSalesTotalHkd: number;
  unpaidIssuedBalanceHkd: number;
  collectedByTender: Array<{ tenderCode: string; txCount: number; collectedAmountHkd: number }>;
  recentBatches: Array<{ id: number; businessDate: string; batchNo: number; status: string; issuedSalesTotalHkd: number; collectedPaymentsTotalHkd: number; closedAtIso: string | null }>;
}

const cell = "border-b border-[#d4d0c8] px-2 py-1";
const button = "border border-[#7f9db9] bg-[#f0f0f0] px-5 py-1 text-[12px] text-black hover:bg-[#e5e1d5] disabled:cursor-not-allowed disabled:opacity-40";

export default function DayEndBackOfficePage() {
  const [date, setDate] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date()));
  const [preview, setPreview] = useState<DayEndPreview | null>(null);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [managerPin, setManagerPin] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  async function loadPreview(value: string) {
    const res = await fetch(`/api/day-end?date=${encodeURIComponent(value)}`);
    const data = (await res.json()) as DayEndPreview & { error?: string };
    if (!res.ok) { setMessage(data.error ?? "未能讀取日結資料"); return; }
    setPreview(data); setMessage("");
  }

  useEffect(() => { setCounted({}); void loadPreview(date); }, [date]);

  const closedBatch = preview?.recentBatches.find((batch) => batch.businessDate === date && batch.status === "closed");
  const expectedTotal = preview?.collectedByTender.reduce((sum, row) => sum + row.collectedAmountHkd, 0) ?? 0;
  const countedTotal = preview?.collectedByTender.reduce((sum, row) => sum + (counted[row.tenderCode] === undefined || counted[row.tenderCode] === "" ? row.collectedAmountHkd : Number(counted[row.tenderCode])), 0) ?? 0;

  async function closeShift() {
    if (!preview || closedBatch) return;
    setBusy(true); setMessage("");
    try {
      const res = await fetch("/api/day-end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CLOSE",
          businessDate: date,
          managerPin: managerPin.trim() || undefined,
          countedByTender: preview.collectedByTender.map((row) => ({
            tenderCode: row.tenderCode,
            countedAmountHkd: counted[row.tenderCode] === undefined || counted[row.tenderCode] === "" ? row.collectedAmountHkd : Number(counted[row.tenderCode]),
          })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; batchNo?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "日結失敗（需要 L4+ 權限）");
      setConfirmClose(false);
      setManagerPin("");
      setMessage(`批次 #${data.batchNo} 已完成，${date} 單據已封存`);
      await loadPreview(date);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "日結失敗");
    } finally { setBusy(false); }
  }

  return (
    <div className="border border-[#808080] bg-[#f0f0f0] font-[Tahoma,'Microsoft_JhengHei',sans-serif] text-black shadow-[4px_4px_8px_rgba(0,0,0,0.25)]">
      <div className="flex items-center border-b border-[#d4d0c8] px-2 py-1 text-[12px] font-bold"><span>日結 - DayendInput</span><span className="ml-auto font-normal">BatchHeader / DayendPad</span></div>
      <div className="flex items-center gap-2 border-b border-[#aca899] p-2 text-[12px]">
        <label>營業日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="ml-2 border border-[#7f9db9] bg-white px-2 py-1" /></label>
        <button type="button" className={button} onClick={() => void loadPreview(date)}>重新計算</button>
        <button type="button" className={button} onClick={() => window.print()}>列印預覽</button>
        <button type="button" disabled={!preview || Boolean(closedBatch) || busy} className={`${button} ml-auto bg-[#e1dfff]`} onClick={() => setConfirmClose(true)}>{closedBatch ? "已日結封存" : "完成日結"}</button>
      </div>
      {message ? <div className="border-b border-[#aca899] bg-[#ffffe1] px-2 py-1 text-[12px] text-[#c00000]">營運通訊息 - 055：{message}</div> : null}
      {preview ? <div className="grid grid-cols-4 gap-px border-b border-[#aca899] bg-[#aca899]"><div className="bg-white p-3"><div className="text-[11px]">開櫃銀頭</div><div className="mt-1 font-mono text-[20px]">{formatHkd(preview.openingFloatHkd ?? 0)}</div></div><div className="bg-white p-3"><div className="text-[11px]">已開單據 ({preview.billCount})</div><div className="mt-1 font-mono text-[20px]">{formatHkd(preview.issuedSalesTotalHkd)}</div></div><div className="bg-white p-3"><div className="text-[11px]">未收發票餘額</div><div className="mt-1 font-mono text-[20px] text-[#9c6500]">{formatHkd(preview.unpaidIssuedBalanceHkd)}</div></div><div className="bg-white p-3"><div className="text-[11px]">已收款項</div><div className="mt-1 font-mono text-[20px] text-[#0a7a2f]">{formatHkd(expectedTotal)}</div></div></div> : null}
      <div className="grid min-h-[390px] grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-auto bg-white">
          <div className="border-b border-[#aca899] bg-[#e8eef5] px-2 py-1 text-[12px] font-bold">DayendPad · 付款方式點算</div>
          <table className="w-full border-collapse text-[12px]"><thead><tr className="bg-[#f4f7fa] text-left"><th className={`${cell} font-normal`}>方法</th><th className={`${cell} text-right font-normal`}>交易數</th><th className={`${cell} text-right font-normal`}>系統應收</th><th className={`${cell} text-right font-normal`}>實點金額</th><th className={`${cell} text-right font-normal`}>差額</th></tr></thead><tbody>{preview?.collectedByTender.map((row) => { const actual = counted[row.tenderCode] === undefined || counted[row.tenderCode] === "" ? row.collectedAmountHkd : Number(counted[row.tenderCode]); return <tr key={row.tenderCode}><td className={`${cell} font-mono font-bold`}>{row.tenderCode}</td><td className={`${cell} text-right`}>{row.txCount}</td><td className={`${cell} text-right font-mono`}>{formatHkd(row.collectedAmountHkd)}</td><td className={`${cell} text-right`}><input type="number" min="0" step="0.01" disabled={Boolean(closedBatch)} value={counted[row.tenderCode] ?? row.collectedAmountHkd} onChange={(event) => setCounted((current) => ({ ...current, [row.tenderCode]: event.target.value }))} className="w-28 border border-[#7f9db9] bg-white px-2 py-0.5 text-right font-mono disabled:bg-[#e8e8e8]" /></td><td className={`${cell} text-right font-mono ${actual - row.collectedAmountHkd === 0 ? "" : "text-[#c00000]"}`}>{formatHkd(actual - row.collectedAmountHkd)}</td></tr>; })}</tbody><tfoot><tr className="bg-[#ffffe1] font-bold"><td className={cell}>總計</td><td className={cell} /><td className={`${cell} text-right`}>{formatHkd(expectedTotal)}</td><td className={`${cell} text-right`}>{formatHkd(countedTotal)}</td><td className={`${cell} text-right`}>{formatHkd(countedTotal - expectedTotal)}</td></tr></tfoot></table>
          {preview && preview.collectedByTender.length === 0 ? <div className="p-8 text-center text-[12px] text-[#666]">{date} 暫無收款記錄</div> : null}
        </div>
        <div className="overflow-auto border-l border-[#aca899] bg-white">
          <div className="border-b border-[#aca899] bg-[#e8eef5] px-2 py-1 text-[12px] font-bold">DayEndList · 最近批次</div>
          <table className="w-full border-collapse text-[11px]"><thead><tr className="text-left"><th className={`${cell} font-normal`}>日期</th><th className={`${cell} font-normal`}>批次</th><th className={`${cell} font-normal`}>狀態</th><th className={`${cell} text-right font-normal`}>收款</th></tr></thead><tbody>{preview?.recentBatches.map((batch) => <tr key={batch.id} className={batch.businessDate === date ? "bg-[#ffffe1]" : ""}><td className={`${cell} font-mono`}>{batch.businessDate}</td><td className={cell}>#{batch.batchNo}</td><td className={cell}>{batch.status === "closed" ? "已封存" : batch.status}</td><td className={`${cell} text-right font-mono`}>{formatHkd(batch.collectedPaymentsTotalHkd)}</td></tr>)}</tbody></table>
        </div>
      </div>
      <div className="border-t border-[#aca899] px-2 py-1 text-[11px] text-[#666]">完成後，當日已完成單據會變為「已封存」，新交易及取消單會被拒絕。</div>
      {confirmClose ? <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/20" role="alertdialog" aria-modal="true"><div className="w-[450px] border border-[#808080] bg-[#f0f0f0] p-4 shadow-xl"><div className="text-[13px] font-bold text-[#2e7ec2]">營運通訊息 - 056</div><div className="mt-2 text-[13px]">確定完成 {date} 日結？完成後當日單據將會封存。</div><div className="mt-2 bg-white p-2 font-mono text-[12px]">應收 {formatHkd(expectedTotal)} · 實點 {formatHkd(countedTotal)} · 差額 {formatHkd(countedTotal - expectedTotal)}</div><label className="mt-3 block text-[12px]">經理覆核密碼 (6位 PIN，非 L4+ 時填寫)<input type="password" inputMode="numeric" maxLength={6} value={managerPin} onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, ""))} placeholder="L4+ 免填" className="mt-1 w-full border border-[#7f9db9] bg-white px-2 py-1 font-mono" /></label><div className="mt-4 flex justify-end gap-2"><button type="button" disabled={busy} className={button} onClick={() => void closeShift()}>{busy ? "處理中…" : "確定日結"}</button><button type="button" autoFocus className={`${button} bg-[#e1dfff]`} onClick={() => setConfirmClose(false)}>離開</button></div></div></div> : null}
    </div>
  );
}
