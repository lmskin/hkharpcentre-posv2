"use client";

import { useEffect, useState } from "react";
import {
  currentBusinessDate,
  downloadCsvFile,
  fmtAmt,
  reportBtn,
  reportCell,
  reportHeader,
  reportInput,
  ReportPaper,
  ReportShell,
  reportTable,
  reportTotalRow,
} from "./ReportShell";

type Granularity = "day" | "week" | "month" | "quarter" | "year" | "weekday";

interface HistoryDayRow {
  businessDate: string;
  periodKey: string;
  periodLabel: string;
  billCount: number;
  cancelledCount: number;
  grossSalesHkd: number;
  discountsHkd: number;
  returnHkd: number;
  netSalesHkd: number;
  avgBillHkd: number;
  collectedHkd: number;
  balanceDueHkd: number;
  payoutHkd: number;
  cashHkd: number;
  octopusHkd: number;
  cardHkd: number;
  bankChequeHkd: number;
}

interface HistoryData {
  fromDate: string;
  toDate: string;
  granularity: Granularity;
  days: HistoryDayRow[];
  totals: {
    billCount: number;
    cancelledCount: number;
    grossSalesHkd: number;
    discountsHkd: number;
    returnHkd: number;
    netSalesHkd: number;
    avgBillHkd: number;
    collectedHkd: number;
    balanceDueHkd: number;
    payoutHkd: number;
    cashHkd: number;
    octopusHkd: number;
    cardHkd: number;
    bankChequeHkd: number;
  };
}

const GRANULARITY_OPTS: Array<[Granularity, string]> = [
  ["day", "按日 (ByDay)"],
  ["week", "按周 (ByWeek)"],
  ["month", "按月 (ByMonth)"],
  ["quarter", "按季 (ByQuarter)"],
  ["year", "按年 (ByYear)"],
  ["weekday", "按星期 (DayOfWk)"],
];

export function HistoryReportPanel({
  embedded = false,
  shopLabel = "Central(1)",
  onClose,
}: {
  embedded?: boolean;
  shopLabel?: string;
  onClose?: () => void;
}) {
  const today = currentBusinessDate();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (from > to) return;
    setData(null);
    fetch(`/api/reports/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&granularity=${granularity}`)
      .then(async (res) => {
        const body = (await res.json()) as HistoryData & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "未能讀取歷史數據");
        setData(body);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "未能讀取歷史數據"));
  }, [from, to, granularity, reloadTick]);

  function handleExportCsv() {
    if (!data) return;
    downloadCsvFile(`history-${data.fromDate}-${data.toDate}-${granularity}.csv`, [
      [
        "營業日期/期間",
        "單數",
        "單折前額",
        "折扣額",
        "退貨額",
        "淨銷售(營業額)",
        "平均每單",
        "已收銀碼",
        "未收餘額",
        "Payout支出",
        "取消單",
        "現金",
        "八達通",
        "信用卡",
        "銀行轉帳/支票",
      ],
      ...data.days.map((r) => [
        r.periodLabel || r.businessDate,
        r.billCount,
        r.grossSalesHkd.toFixed(2),
        r.discountsHkd.toFixed(2),
        r.returnHkd.toFixed(2),
        r.netSalesHkd.toFixed(2),
        r.avgBillHkd.toFixed(2),
        r.collectedHkd.toFixed(2),
        r.balanceDueHkd.toFixed(2),
        r.payoutHkd.toFixed(2),
        r.cancelledCount,
        r.cashHkd.toFixed(2),
        r.octopusHkd.toFixed(2),
        r.cardHkd.toFixed(2),
        r.bankChequeHkd.toFixed(2),
      ]),
    ]);
  }

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <label>
        由
        <input
          type="date"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          className={`${reportInput} ml-1`}
        />
      </label>
      <label>
        至
        <input
          type="date"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          className={`${reportInput} ml-1`}
        />
      </label>
      <label>
        統計週期
        <select
          value={granularity}
          onChange={(e) => setGranularity(e.target.value as Granularity)}
          className={`${reportInput} ml-1`}
        >
          {GRANULARITY_OPTS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  const body = data ? (
    <table className={reportTable}>
      <thead className="sticky top-0 z-10">
        <tr className={reportHeader}>
          <th className="px-2 py-1 font-bold">營業日期 / 期間</th>
          <th className="px-2 py-1 text-right font-bold">單數</th>
          <th className="px-2 py-1 text-right font-bold">單折前額</th>
          <th className="px-2 py-1 text-right font-bold">折扣額</th>
          <th className="px-2 py-1 text-right font-bold">退貨額</th>
          <th className="px-2 py-1 text-right font-bold">淨銷售(營業額)</th>
          <th className="px-2 py-1 text-right font-bold">平均每單</th>
          <th className="px-2 py-1 text-right font-bold">已收銀碼</th>
          <th className="px-2 py-1 text-right font-bold">未收餘額</th>
          <th className="px-2 py-1 text-right font-bold">Payout支出</th>
          <th className="px-2 py-1 text-right font-bold">取消單</th>
          <th className="px-2 py-1 text-right font-bold">現金</th>
          <th className="px-2 py-1 text-right font-bold">八達通</th>
          <th className="px-2 py-1 text-right font-bold">信用卡</th>
          <th className="px-2 py-1 text-right font-bold">轉帳/支票</th>
        </tr>
      </thead>
      <tbody>
        {data.days.map((row, index) => (
          <tr key={row.periodKey || row.businessDate} className={index % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
            <td className={`${reportCell} font-mono font-semibold`}>{row.periodLabel || row.businessDate}</td>
            <td className={`${reportCell} text-right font-mono`}>{row.billCount}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.grossSalesHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.discountsHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.returnHkd)}</td>
            <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(row.netSalesHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.avgBillHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.collectedHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.balanceDueHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.payoutHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{row.cancelledCount}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.cashHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.octopusHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.cardHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.bankChequeHkd)}</td>
          </tr>
        ))}
        {data.days.length === 0 ? (
          <tr>
            <td colSpan={15} className="p-8 text-center text-[#666]">
              此期間暫無歷史營業數據
            </td>
          </tr>
        ) : null}
      </tbody>
      <tfoot>
        <tr className={reportTotalRow}>
          <td className={reportCell}>總計</td>
          <td className={`${reportCell} text-right font-mono`}>{data.totals.billCount}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.grossSalesHkd)}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.discountsHkd)}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.returnHkd)}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.netSalesHkd)}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.avgBillHkd)}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.collectedHkd)}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.balanceDueHkd)}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.payoutHkd)}</td>
          <td className={`${reportCell} text-right font-mono`}>{data.totals.cancelledCount}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.cashHkd)}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.octopusHkd)}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.cardHkd)}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.bankChequeHkd)}</td>
        </tr>
      </tfoot>
    </table>
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
            reportTitle="歷史營業額及月計分析報表"
            legacyCode="dhsales / ReportM"
            subtitle={`期間: ${from} 至 ${to} (${GRANULARITY_OPTS.find((g) => g[0] === granularity)?.[1]})`}
            shopLabel={shopLabel}
            recordCount={data?.days.length}
          >
            {body}
          </ReportPaper>
        </div>
      </div>
    );
  }

  return (
    <ReportShell
      title="歷史數據"
      legacyCode="dhsales / ReportM"
      subtitle={`期間: ${from} 至 ${to}`}
      shopLabel={shopLabel}
      recordCount={data?.days.length}
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

export function HistoryReport({ onClose }: { onClose: () => void }) {
  return <HistoryReportPanel onClose={onClose} />;
}
