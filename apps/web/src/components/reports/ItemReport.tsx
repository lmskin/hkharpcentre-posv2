"use client";

import { useEffect, useState } from "react";
import { formatHkd } from "@hkharp/domain/money";
import { currentBusinessDate, downloadCsvFile, ReportShell, reportCell, reportHeader, reportTable } from "./ReportShell";

interface ItemData { businessDate: string; totalSalesHkd: number; items: Array<{ sku: string; nameZh: string; nameEn: string; quantity: number; netSalesHkd: number; salesShare: number }> }

export function ItemReport({ onClose }: { onClose: () => void }) {
  const [date, setDate] = useState(currentBusinessDate);
  const [data, setData] = useState<ItemData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    fetch(`/api/reports/items?date=${date}`).then(async (res) => {
      const body = (await res.json()) as ItemData & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "未能產生項報");
      setData(body); setError("");
    }).catch((err) => setError(err instanceof Error ? err.message : "未能產生項報"));
  }, [date]);
  return (
    <ReportShell
      title="項報"
      error={error}
      onClose={onClose}
      onExportCsv={
        data
          ? () =>
              downloadCsvFile(`items-${data.businessDate}.csv`, [
                ["SKU", "NameZH", "NameEN", "Quantity", "NetSalesHKD", "SharePct"],
                ...data.items.map((r) => [
                  r.sku,
                  r.nameZh,
                  r.nameEn,
                  r.quantity,
                  r.netSalesHkd.toFixed(2),
                  (r.salesShare * 100).toFixed(2),
                ]),
              ])
          : undefined
      }
      controls={<label>營業日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="ml-2 border border-[#7f9db9] bg-white px-2 py-1" /></label>}
    >
      {data ? <table className={reportTable}><thead className="sticky top-0"><tr className={reportHeader}><th className="px-2 py-1 font-normal">條碼</th><th className="px-2 py-1 font-normal">貨品</th><th className="px-2 py-1 text-right font-normal">數量</th><th className="px-2 py-1 text-right font-normal">銷售金額</th><th className="px-2 py-1 text-right font-normal">佔比</th></tr></thead><tbody>{data.items.map((row, index) => <tr key={row.sku} className={index % 2 ? "bg-[#f4f7fa]" : "bg-white"}><td className={`${reportCell} font-mono`}>{row.sku}</td><td className={reportCell}>{row.nameZh || row.nameEn}</td><td className={`${reportCell} text-right font-mono`}>{row.quantity}</td><td className={`${reportCell} text-right font-mono`}>{formatHkd(row.netSalesHkd)}</td><td className={`${reportCell} text-right font-mono`}>{(row.salesShare * 100).toFixed(2)}%</td></tr>)}</tbody><tfoot><tr className="bg-[#ffffe1] font-bold"><td className={reportCell} colSpan={3}>總計 · {data.items.length} 項</td><td className={`${reportCell} text-right`}>{formatHkd(data.totalSalesHkd)}</td><td className={`${reportCell} text-right`}>100.00%</td></tr></tfoot></table> : <div className="p-6 text-center text-[12px]">讀取中…</div>}
    </ReportShell>
  );
}
