"use client";

import { useEffect, useState } from "react";
import { formatHkd } from "@hkharp/domain/money";
import { currentBusinessDate, downloadCsvFile, ReportShell, reportCell, reportHeader, reportTable } from "./ReportShell";

interface ManagerStatsData {
  range: { fromDate: string; toDate: string };
  customerStats: Array<{
    customerId: number;
    legacyId: string;
    nameZh: string;
    nameEn: string;
    pointsBalance: number;
    billCount: number;
    netSpendHkd: number;
  }>;
  staffStats: Array<{
    staffId: number;
    legacyId: string;
    displayName: string;
    billCount: number;
    netSalesHkd: number;
  }>;
  docTypeStats: Array<{
    docType: string;
    docCount: number;
    totalAmountHkd: number;
  }>;
}

type StatsTab = "customers" | "staff" | "doctypes";

export function ManagerStatsReport({ onClose }: { onClose: () => void }) {
  const today = currentBusinessDate();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [tab, setTab] = useState<StatsTab>("customers");
  const [data, setData] = useState<ManagerStatsData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (from > to) return;
    setData(null);
    fetch(`/api/reports?view=stats&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(async (res) => {
        const body = (await res.json()) as ManagerStatsData & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "未能讀取營業統計");
        setData(body);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "未能讀取營業統計"));
  }, [from, to]);

  function handleExportCsv() {
    if (!data) return;
    if (tab === "customers") {
      downloadCsvFile(`stats-customers-${from}-${to}.csv`, [
        ["CustomerID", "NameZH", "NameEN", "PointsBalance", "BillCount", "NetSpendHKD"],
        ...data.customerStats.map((r) => [
          r.legacyId,
          r.nameZh,
          r.nameEn,
          r.pointsBalance,
          r.billCount,
          r.netSpendHkd.toFixed(2),
        ]),
      ]);
      return;
    }
    if (tab === "staff") {
      downloadCsvFile(`stats-staff-${from}-${to}.csv`, [
        ["StaffID", "DisplayName", "BillCount", "NetSalesHKD"],
        ...data.staffStats.map((r) => [r.legacyId, r.displayName, r.billCount, r.netSalesHkd.toFixed(2)]),
      ]);
      return;
    }
    downloadCsvFile(`stats-doctypes-${from}-${to}.csv`, [
      ["DocType", "DocCount", "TotalAmountHKD"],
      ...data.docTypeStats.map((r) => [r.docType, r.docCount, r.totalAmountHkd.toFixed(2)]),
    ]);
  }

  return (
    <ReportShell
      title="營業統計"
      error={error}
      onClose={onClose}
      onExportCsv={data ? handleExportCsv : undefined}
      controls={
        <div className="flex flex-wrap items-center gap-2">
          <label>
            由
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="ml-1 border border-[#7f9db9] bg-white px-2 py-1"
            />
          </label>
          <label>
            至
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="ml-1 border border-[#7f9db9] bg-white px-2 py-1"
            />
          </label>
          <div className="ml-2 flex items-center gap-1">
            {(
              [
                ["customers", "會員統計"],
                ["staff", "職員統計"],
                ["doctypes", "交易及損耗紀錄"],
              ] as Array<[StatsTab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`border border-[#7f9db9] px-3 py-1 ${
                  tab === id ? "bg-[#316ac5] font-bold text-white" : "bg-[#f0f0f0] text-black hover:bg-[#e5e1d5]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {!data ? (
        <div className="p-6 text-center text-[12px]">讀取中…</div>
      ) : tab === "customers" ? (
        <table className={reportTable}>
          <thead className="sticky top-0">
            <tr className={reportHeader}>
              <th className="px-2 py-1 font-normal">會員編號</th>
              <th className="px-2 py-1 font-normal">會員姓名</th>
              <th className="px-2 py-1 text-right font-normal">單數</th>
              <th className="px-2 py-1 text-right font-normal">結餘積分</th>
              <th className="px-2 py-1 text-right font-normal">淨消費額</th>
            </tr>
          </thead>
          <tbody>
            {data.customerStats.map((row, index) => (
              <tr key={row.customerId} className={index % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
                <td className={`${reportCell} font-mono`}>{row.legacyId}</td>
                <td className={reportCell}>{row.nameZh || row.nameEn}</td>
                <td className={`${reportCell} text-right font-mono`}>{row.billCount}</td>
                <td className={`${reportCell} text-right font-mono`}>{row.pointsBalance}</td>
                <td className={`${reportCell} text-right font-mono`}>{formatHkd(row.netSpendHkd)}</td>
              </tr>
            ))}
            {data.customerStats.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-[#808080]">
                  此期間暫無會員銷售統計
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : tab === "staff" ? (
        <table className={reportTable}>
          <thead className="sticky top-0">
            <tr className={reportHeader}>
              <th className="px-2 py-1 font-normal">職員編號</th>
              <th className="px-2 py-1 font-normal">職員姓名</th>
              <th className="px-2 py-1 text-right font-normal">單數</th>
              <th className="px-2 py-1 text-right font-normal">淨銷售額</th>
            </tr>
          </thead>
          <tbody>
            {data.staffStats.map((row, index) => (
              <tr key={`${row.staffId}-${row.legacyId}`} className={index % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
                <td className={`${reportCell} font-mono`}>{row.legacyId}</td>
                <td className={reportCell}>{row.displayName}</td>
                <td className={`${reportCell} text-right font-mono`}>{row.billCount}</td>
                <td className={`${reportCell} text-right font-mono`}>{formatHkd(row.netSalesHkd)}</td>
              </tr>
            ))}
            {data.staffStats.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-6 text-center text-[#808080]">
                  此期間暫無職員銷售統計
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : (
        <table className={reportTable}>
          <thead className="sticky top-0">
            <tr className={reportHeader}>
              <th className="px-2 py-1 font-normal">單據類型</th>
              <th className="px-2 py-1 text-right font-normal">單據數量</th>
              <th className="px-2 py-1 text-right font-normal">合計金額</th>
            </tr>
          </thead>
          <tbody>
            {data.docTypeStats.map((row, index) => (
              <tr key={row.docType} className={index % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
                <td className={`${reportCell} font-mono font-bold`}>{row.docType}</td>
                <td className={`${reportCell} text-right font-mono`}>{row.docCount}</td>
                <td className={`${reportCell} text-right font-mono`}>{formatHkd(row.totalAmountHkd)}</td>
              </tr>
            ))}
            {data.docTypeStats.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-6 text-center text-[#808080]">
                  此期間暫無交易及損耗紀錄
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}
    </ReportShell>
  );
}
