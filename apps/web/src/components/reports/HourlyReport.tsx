"use client";

import { useEffect, useState } from "react";
import { formatHkd } from "@hkharp/domain/money";
import { currentBusinessDate, downloadCsvFile, ReportShell, reportCell, reportHeader, reportTable } from "./ReportShell";

interface HourlyData { businessDate: string; totalBills: number; totalSalesHkd: number; hours: Array<{ hourOfDay: number; billCount: number; netSalesHkd: number; averageBillHkd: number }> }

export function HourlyReport({ onClose }: { onClose: () => void }) {
  const [date, setDate] = useState(currentBusinessDate);
  const [data, setData] = useState<HourlyData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    fetch(`/api/reports/hourly?date=${date}`).then(async (res) => {
      const body = (await res.json()) as HourlyData & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "未能產生時報");
      setData(body); setError("");
    }).catch((err) => setError(err instanceof Error ? err.message : "未能產生時報"));
  }, [date]);
  return (
    <ReportShell
      title="時報"
      error={error}
      onClose={onClose}
      onExportCsv={
        data
          ? () =>
              downloadCsvFile(`hourly-${data.businessDate}.csv`, [
                ["Hour", "BillCount", "NetSalesHKD", "AverageBillHKD"],
                ...data.hours.map((r) => [
                  `${String(r.hourOfDay).padStart(2, "0")}:00-${String(r.hourOfDay).padStart(2, "0")}:59`,
                  r.billCount,
                  r.netSalesHkd.toFixed(2),
                  r.averageBillHkd.toFixed(2),
                ]),
              ])
          : undefined
      }
      controls={<label>營業日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="ml-2 border border-[#7f9db9] bg-white px-2 py-1" /></label>}
    >
      {data ? <table className={reportTable}><thead className="sticky top-0"><tr className={reportHeader}><th className="px-2 py-1 font-normal">時間</th><th className="px-2 py-1 text-right font-normal">單數</th><th className="px-2 py-1 text-right font-normal">銷售金額</th><th className="px-2 py-1 text-right font-normal">平均每單</th></tr></thead><tbody>{data.hours.map((row, index) => <tr key={row.hourOfDay} className={index % 2 ? "bg-[#f4f7fa]" : "bg-white"}><td className={reportCell}>{String(row.hourOfDay).padStart(2, "0")}:00 - {String(row.hourOfDay).padStart(2, "0")}:59</td><td className={`${reportCell} text-right font-mono`}>{row.billCount}</td><td className={`${reportCell} text-right font-mono`}>{formatHkd(row.netSalesHkd)}</td><td className={`${reportCell} text-right font-mono`}>{formatHkd(row.averageBillHkd)}</td></tr>)}</tbody><tfoot><tr className="bg-[#ffffe1] font-bold"><td className={reportCell}>總計</td><td className={`${reportCell} text-right`}>{data.totalBills}</td><td className={`${reportCell} text-right`}>{formatHkd(data.totalSalesHkd)}</td><td className={reportCell} /></tr></tfoot></table> : <div className="p-6 text-center text-[12px]">讀取中…</div>}
    </ReportShell>
  );
}
