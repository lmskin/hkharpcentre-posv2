"use client";

import { useEffect, useState } from "react";
import { formatHkd } from "@hkharp/domain/money";
import { currentBusinessDate, downloadCsvFile, ReportShell, reportCell, reportHeader, reportTable } from "./ReportShell";

interface HistoryData { fromDate: string; toDate: string; days: Array<{ businessDate: string; billCount: number; grossSalesHkd: number; discountsHkd: number; netSalesHkd: number; collectedHkd: number; balanceDueHkd: number }> }

export function HistoryReport({ onClose }: { onClose: () => void }) {
  const today = currentBusinessDate();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (from > to) return;
    setData(null);
    fetch(`/api/reports/history?from=${from}&to=${to}`).then(async (res) => {
      const body = (await res.json()) as HistoryData & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "未能讀取歷史數據");
      setData(body); setError("");
    }).catch((err) => setError(err instanceof Error ? err.message : "未能讀取歷史數據"));
  }, [from, to]);
  const totals = data?.days.reduce((sum, day) => ({ bills: sum.bills + day.billCount, net: sum.net + day.netSalesHkd, collected: sum.collected + day.collectedHkd, balance: sum.balance + day.balanceDueHkd }), { bills: 0, net: 0, collected: 0, balance: 0 });
  return (
    <ReportShell
      title="歷史數據"
      error={error}
      onClose={onClose}
      onExportCsv={
        data
          ? () =>
              downloadCsvFile(`history-${data.fromDate}-${data.toDate}.csv`, [
                ["BusinessDate", "BillCount", "GrossSalesHKD", "DiscountsHKD", "NetSalesHKD", "CollectedHKD", "BalanceDueHKD"],
                ...data.days.map((r) => [
                  r.businessDate,
                  r.billCount,
                  r.grossSalesHkd.toFixed(2),
                  r.discountsHkd.toFixed(2),
                  r.netSalesHkd.toFixed(2),
                  r.collectedHkd.toFixed(2),
                  r.balanceDueHkd.toFixed(2),
                ]),
              ])
          : undefined
      }
      controls={<><label>由<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="ml-2 border border-[#7f9db9] bg-white px-2 py-1" /></label><label>至<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="ml-2 border border-[#7f9db9] bg-white px-2 py-1" /></label></>}
    >
      {data ? <table className={reportTable}><thead className="sticky top-0"><tr className={reportHeader}><th className="px-2 py-1 font-normal">營業日期</th><th className="px-2 py-1 text-right font-normal">單數</th><th className="px-2 py-1 text-right font-normal">原價</th><th className="px-2 py-1 text-right font-normal">折扣</th><th className="px-2 py-1 text-right font-normal">淨銷售</th><th className="px-2 py-1 text-right font-normal">已收</th><th className="px-2 py-1 text-right font-normal">未收</th></tr></thead><tbody>{data.days.map((row, index) => <tr key={row.businessDate} className={index % 2 ? "bg-[#f4f7fa]" : "bg-white"}><td className={`${reportCell} font-mono`}>{row.businessDate}</td><td className={`${reportCell} text-right`}>{row.billCount}</td><td className={`${reportCell} text-right`}>{formatHkd(row.grossSalesHkd)}</td><td className={`${reportCell} text-right`}>{formatHkd(row.discountsHkd)}</td><td className={`${reportCell} text-right`}>{formatHkd(row.netSalesHkd)}</td><td className={`${reportCell} text-right`}>{formatHkd(row.collectedHkd)}</td><td className={`${reportCell} text-right`}>{formatHkd(row.balanceDueHkd)}</td></tr>)}</tbody>{totals ? <tfoot><tr className="bg-[#ffffe1] font-bold"><td className={reportCell}>總計</td><td className={`${reportCell} text-right`}>{totals.bills}</td><td className={reportCell} colSpan={2} /><td className={`${reportCell} text-right`}>{formatHkd(totals.net)}</td><td className={`${reportCell} text-right`}>{formatHkd(totals.collected)}</td><td className={`${reportCell} text-right`}>{formatHkd(totals.balance)}</td></tr></tfoot> : null}</table> : <div className="p-6 text-center text-[12px]">讀取中…</div>}
    </ReportShell>
  );
}
