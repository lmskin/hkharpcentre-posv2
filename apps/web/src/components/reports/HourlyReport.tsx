"use client";

import { useEffect, useState } from "react";
import {
  currentBusinessDate,
  downloadCsvFile,
  fmtAmt,
  fmtPct,
  reportBtn,
  reportCell,
  reportHeader,
  reportInput,
  ReportPaper,
  ReportShell,
  reportSubTotalRow,
  reportTable,
  reportTotalRow,
} from "./ReportShell";

interface HourlyRow {
  hourOfDay: number;
  billCount: number;
  grossSalesHkd: number;
  discountHkd: number;
  returnHkd: number;
  netSalesHkd: number;
  averageBillHkd: number;
  sharePct: number;
  byTender: Record<string, number>;
}

interface HourlyData {
  businessDate: string;
  totalBills: number;
  totalGrossHkd: number;
  totalDiscountHkd: number;
  totalReturnHkd: number;
  totalSalesHkd: number;
  averageBillHkd: number;
  hours: HourlyRow[];
  periods: Array<{
    key: string;
    label: string;
    billCount: number;
    grossSalesHkd: number;
    discountHkd: number;
    returnHkd: number;
    netSalesHkd: number;
    averageBillHkd: number;
    sharePct: number;
  }>;
  tenderTotals: Record<string, number>;
  cancelledBillCount: number;
  cancelledAmountHkd: number;
  cancelledLineCount: number;
}

const TENDER_COLS = [
  ["CASH", "現金"],
  ["OCTOPUS", "八達通"],
  ["VISA", "Visa"],
  ["MASTERCARD", "Master"],
  ["UNIONPAY", "銀聯"],
  ["BANK_XFER", "轉帳"],
  ["AMEX", "AE"],
  ["CHEQUE", "支票"],
] as const;

export function HourlyReportPanel({
  embedded = false,
  shopLabel = "Central(1)",
  onClose,
}: {
  embedded?: boolean;
  shopLabel?: string;
  onClose?: () => void;
}) {
  const [date, setDate] = useState(currentBusinessDate);
  const [showTenders, setShowTenders] = useState(true);
  const [data, setData] = useState<HourlyData | null>(null);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    setData(null);
    fetch(`/api/reports/hourly?date=${encodeURIComponent(date)}`)
      .then(async (res) => {
        const body = (await res.json()) as HourlyData & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "未能產生時報");
        setData(body);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "未能產生時報"));
  }, [date, reloadTick]);

  function handleExportCsv() {
    if (!data) return;
    downloadCsvFile(`hourly-${data.businessDate}.csv`, [
      [
        "時段",
        "單數",
        "單折前額",
        "折扣額",
        "退貨額",
        "營業額",
        "平均每單",
        "佔比%",
        ...TENDER_COLS.map(([, label]) => label),
      ],
      ...data.hours.map((r) => [
        `${String(r.hourOfDay).padStart(2, "0")}:00-${String(r.hourOfDay).padStart(2, "0")}:59`,
        r.billCount,
        r.grossSalesHkd.toFixed(2),
        r.discountHkd.toFixed(2),
        r.returnHkd.toFixed(2),
        r.netSalesHkd.toFixed(2),
        r.averageBillHkd.toFixed(2),
        r.sharePct.toFixed(2),
        ...TENDER_COLS.map(([code]) => (r.byTender[code] ?? 0).toFixed(2)),
      ]),
    ]);
  }

  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      <label>
        營業日期
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className={`${reportInput} ml-1`}
        />
      </label>
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={showTenders}
          onChange={(event) => setShowTenders(event.target.checked)}
        />
        顯示付款方法明細 (現鈔/八達通/信用卡/轉帳)
      </label>
    </div>
  );

  const body = data ? (
    <div className="space-y-2 p-2">
      <table className={reportTable}>
        <thead className="sticky top-0 z-10">
          <tr className={reportHeader}>
            <th className="px-2 py-1 font-bold">時間 (時飛)</th>
            <th className="px-2 py-1 text-right font-bold">單數</th>
            <th className="px-2 py-1 text-right font-bold">單折前額</th>
            <th className="px-2 py-1 text-right font-bold">折扣額</th>
            <th className="px-2 py-1 text-right font-bold">退貨額</th>
            <th className="px-2 py-1 text-right font-bold">營業額</th>
            <th className="px-2 py-1 text-right font-bold">平均每單</th>
            <th className="px-2 py-1 text-right font-bold">佔比%</th>
            {showTenders
              ? TENDER_COLS.map(([code, label]) => (
                  <th key={code} className="px-2 py-1 text-right font-bold">
                    {label}
                  </th>
                ))
              : null}
          </tr>
        </thead>
        <tbody>
          {data.hours.map((row, index) => (
            <tr key={row.hourOfDay} className={index % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
              <td className={`${reportCell} font-mono`}>
                {String(row.hourOfDay).padStart(2, "0")}:00 - {String(row.hourOfDay).padStart(2, "0")}:59
              </td>
              <td className={`${reportCell} text-right font-mono`}>{row.billCount}</td>
              <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.grossSalesHkd)}</td>
              <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.discountHkd)}</td>
              <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.returnHkd)}</td>
              <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(row.netSalesHkd)}</td>
              <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.averageBillHkd)}</td>
              <td className={`${reportCell} text-right font-mono`}>{fmtPct(row.sharePct)}</td>
              {showTenders
                ? TENDER_COLS.map(([code]) => (
                    <td key={code} className={`${reportCell} text-right font-mono`}>
                      {(row.byTender[code] ?? 0) !== 0 ? fmtAmt(row.byTender[code] ?? 0) : "-"}
                    </td>
                  ))
                : null}
            </tr>
          ))}
          {data.periods.map((p) => (
            <tr key={p.key} className={reportSubTotalRow}>
              <td className={reportCell}>小計 · {p.label}</td>
              <td className={`${reportCell} text-right font-mono`}>{p.billCount}</td>
              <td className={`${reportCell} text-right font-mono`}>{fmtAmt(p.grossSalesHkd)}</td>
              <td className={`${reportCell} text-right font-mono`}>{fmtAmt(p.discountHkd)}</td>
              <td className={`${reportCell} text-right font-mono`}>{fmtAmt(p.returnHkd)}</td>
              <td className={`${reportCell} text-right font-mono`}>{fmtAmt(p.netSalesHkd)}</td>
              <td className={`${reportCell} text-right font-mono`}>{fmtAmt(p.averageBillHkd)}</td>
              <td className={`${reportCell} text-right font-mono`}>{fmtPct(p.sharePct)}</td>
              {showTenders ? <td className={reportCell} colSpan={TENDER_COLS.length} /> : null}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={reportTotalRow}>
            <td className={reportCell}>總計</td>
            <td className={`${reportCell} text-right font-mono`}>{data.totalBills}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totalGrossHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totalDiscountHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totalReturnHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totalSalesHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.averageBillHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>100.00%</td>
            {showTenders
              ? TENDER_COLS.map(([code]) => (
                  <td key={code} className={`${reportCell} text-right font-mono`}>
                    {fmtAmt(data.tenderTotals[code] ?? 0)}
                  </td>
                ))
              : null}
          </tr>
        </tfoot>
      </table>

      <div className="flex flex-wrap gap-6 border border-[#7f9db9] bg-[#f8fafc] px-3 py-1.5 text-[12px] text-black">
        <span>
          取消單數: <strong className="font-mono text-[#c00000]">{data.cancelledBillCount}</strong>
        </span>
        <span>
          取消單金額: <strong className="font-mono text-[#c00000]">{fmtAmt(data.cancelledAmountHkd)}</strong>
        </span>
        <span>
          取消項目數: <strong className="font-mono text-[#c00000]">{data.cancelledLineCount}</strong>
        </span>
      </div>
    </div>
  ) : (
    <div className="p-6 text-center text-[12px]">讀取中…</div>
  );

  if (embedded) {
    return (
      <div className="flex h-full flex-col">
        <div className="print-hide flex flex-wrap items-center gap-2 border-b border-[#aca899] bg-[#f0f0f0] p-2 text-[12px]">
          {controls}
          <div className="ml-auto flex gap-1.5">
            <button type="button" onClick={() => setReloadTick((n) => n + 1)} className={reportBtn}>
              執行查詢
            </button>
            <button type="button" disabled={!data} onClick={handleExportCsv} className={reportBtn}>
              匯出 CSV
            </button>
            <button type="button" onClick={() => window.print()} className={reportBtn}>
              列印預覽
            </button>
          </div>
        </div>
        {error ? (
          <div className="print-hide bg-[#ffffe1] px-2 py-1 text-[12px] text-[#c00000]">營運通訊息 - 053：{error}</div>
        ) : null}
        <div className="legacy-report-scroll min-h-0 flex-1 overflow-auto bg-white">
          <ReportPaper
            reportTitle="每日營業報告 - (按時) / 時報"
            legacyCode="fmdhsales / dhsales"
            subtitle={`營業日期: ${date}`}
            shopLabel={shopLabel}
            recordCount={24}
          >
            {body}
          </ReportPaper>
        </div>
      </div>
    );
  }

  return (
    <ReportShell
      title="時報"
      legacyCode="fmdhsales / dhsales"
      subtitle={`營業日期: ${date}`}
      shopLabel={shopLabel}
      recordCount={24}
      error={error}
      onClose={onClose}
      onRefresh={() => setReloadTick((n) => n + 1)}
      onExportCsv={data ? handleExportCsv : undefined}
      controls={controls}
    >
      {body}
    </ReportShell>
  );
}

export function HourlyReport({ onClose }: { onClose: () => void }) {
  return <HourlyReportPanel onClose={onClose} />;
}
