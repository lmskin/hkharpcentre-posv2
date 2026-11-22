"use client";

import { useEffect, useState } from "react";
import {
  currentBusinessDate,
  downloadCsvFile,
  fmtAmt,
  fmtQty,
  reportBtn,
  reportCell,
  reportHeader,
  reportInput,
  ReportPaper,
  ReportShell,
  reportTable,
  reportTotalRow,
} from "./ReportShell";

interface ManagerStatsData {
  range: { fromDate: string; toDate: string };
  customerStats: Array<{
    customerId: number;
    legacyId: string;
    nameZh: string;
    nameEn: string;
    phone: string;
    gradeName: string;
    pointsBalance: number;
    billCount: number;
    netSpendHkd: number;
    avgBillHkd: number;
    lastVisitDate: string;
  }>;
  staffStats: Array<{
    staffId: number;
    legacyId: string;
    displayName: string;
    billCount: number;
    voidCount: number;
    grossSalesHkd: number;
    discountsHkd: number;
    returnHkd: number;
    netSalesHkd: number;
  }>;
  docTypeStats: Array<{
    docType: string;
    docTypeLabel: string;
    legacyXc: number;
    docCount: number;
    totalAmountHkd: number;
    signedAmountHkd: number;
  }>;
  supplierStats: Array<{
    legacyId: string;
    nameZh: string;
    nameEn: string;
    phone: string;
    grcCount: number;
    prcCount: number;
    netQty: number;
    purchaseHkd: number;
    returnHkd: number;
    netPurchaseHkd: number;
  }>;
  activityLogs: Array<{
    id: number;
    action: string;
    entityType: string;
    entityId: string;
    staffCode: string;
    staffName: string;
    detailsSummary: string;
    createdAtIso: string;
  }>;
}

type StatsTab = "customers" | "staff" | "doctypes" | "suppliers" | "activity";

const TABS: Array<[StatsTab, string]> = [
  ["customers", "會員統計"],
  ["staff", "職員統計"],
  ["doctypes", "交易及損耗紀錄"],
  ["suppliers", "供應商交易摘要"],
  ["activity", "系統活動日誌 (activit)"],
];

export function ManagerStatsPanel({
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
  const [tab, setTab] = useState<StatsTab>("customers");
  const [data, setData] = useState<ManagerStatsData | null>(null);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

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
  }, [from, to, reloadTick]);

  function handleExportCsv() {
    if (!data) return;
    if (tab === "customers") {
      downloadCsvFile(`stats-customers-${from}-${to}.csv`, [
        ["會員編號", "會員姓名", "級別", "電話", "單數", "平均每單", "結餘積分", "最近惠顧日", "淨消費額"],
        ...data.customerStats.map((r) => [
          r.legacyId,
          r.nameZh || r.nameEn,
          r.gradeName,
          r.phone,
          r.billCount,
          r.avgBillHkd.toFixed(2),
          r.pointsBalance,
          r.lastVisitDate,
          r.netSpendHkd.toFixed(2),
        ]),
      ]);
      return;
    }
    if (tab === "staff") {
      downloadCsvFile(`stats-staff-${from}-${to}.csv`, [
        ["職員編號", "職員姓名", "單數", "取消單", "折前額", "折扣額", "退貨額", "淨銷售額"],
        ...data.staffStats.map((r) => [
          r.legacyId,
          r.displayName,
          r.billCount,
          r.voidCount,
          r.grossSalesHkd.toFixed(2),
          r.discountsHkd.toFixed(2),
          r.returnHkd.toFixed(2),
          r.netSalesHkd.toFixed(2),
        ]),
      ]);
      return;
    }
    if (tab === "doctypes") {
      downloadCsvFile(`stats-doctypes-${from}-${to}.csv`, [
        ["交易代碼", "交易種類", "XC", "單據數量", "單面總額", "加減後淨額"],
        ...data.docTypeStats.map((r) => [
          r.docType,
          r.docTypeLabel,
          r.legacyXc,
          r.docCount,
          r.totalAmountHkd.toFixed(2),
          r.signedAmountHkd.toFixed(2),
        ]),
      ]);
      return;
    }
    if (tab === "suppliers") {
      downloadCsvFile(`stats-suppliers-${from}-${to}.csv`, [
        ["供應商編號", "供應商名稱", "電話", "到貨單數", "退貨單數", "淨入貨數量", "到貨金額", "退貨金額", "淨採購額"],
        ...data.supplierStats.map((r) => [
          r.legacyId,
          r.nameZh || r.nameEn,
          r.phone,
          r.grcCount,
          r.prcCount,
          r.netQty,
          r.purchaseHkd.toFixed(2),
          r.returnHkd.toFixed(2),
          r.netPurchaseHkd.toFixed(2),
        ]),
      ]);
      return;
    }
    downloadCsvFile(`stats-activity-${from}-${to}.csv`, [
      ["ID", "時間(HKT)", "操作職員", "動作", "對象類型", "對象單號", "詳情"],
      ...data.activityLogs.map((r) => [
        r.id,
        r.createdAtIso,
        `${r.staffCode} ${r.staffName}`,
        r.action,
        r.entityType,
        r.entityId,
        r.detailsSummary,
      ]),
    ]);
  }

  const activeCount = !data
    ? undefined
    : tab === "customers"
      ? data.customerStats.length
      : tab === "staff"
        ? data.staffStats.length
        : tab === "doctypes"
          ? data.docTypeStats.length
          : tab === "suppliers"
            ? data.supplierStats.length
            : data.activityLogs.length;

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
      <div className="ml-1 flex flex-wrap items-center gap-1">
        {TABS.map(([id, label]) => (
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
  );

  const tableBody = !data ? (
    <div className="p-6 text-center text-[12px]">讀取中…</div>
  ) : tab === "customers" ? (
    <table className={reportTable}>
      <thead className="sticky top-0">
        <tr className={reportHeader}>
          <th className="px-2 py-1 font-bold">會員編號</th>
          <th className="px-2 py-1 font-bold">會員姓名</th>
          <th className="px-2 py-1 font-bold">級別</th>
          <th className="px-2 py-1 font-bold">電話</th>
          <th className="px-2 py-1 text-right font-bold">單數</th>
          <th className="px-2 py-1 text-right font-bold">平均每單</th>
          <th className="px-2 py-1 text-right font-bold">結餘積分</th>
          <th className="px-2 py-1 font-bold">最近惠顧日</th>
          <th className="px-2 py-1 text-right font-bold">淨消費額</th>
        </tr>
      </thead>
      <tbody>
        {data.customerStats.map((row, index) => (
          <tr key={row.customerId} className={index % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
            <td className={`${reportCell} font-mono`}>{row.legacyId}</td>
            <td className={reportCell}>{row.nameZh || row.nameEn}</td>
            <td className={reportCell}>{row.gradeName}</td>
            <td className={`${reportCell} font-mono`}>{row.phone || "-"}</td>
            <td className={`${reportCell} text-right font-mono`}>{row.billCount}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.avgBillHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{row.pointsBalance.toLocaleString()}</td>
            <td className={`${reportCell} font-mono`}>{row.lastVisitDate}</td>
            <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(row.netSpendHkd)}</td>
          </tr>
        ))}
        {data.customerStats.length === 0 ? (
          <tr>
            <td colSpan={9} className="p-6 text-center text-[#808080]">
              此期間暫無會員銷售統計
            </td>
          </tr>
        ) : null}
      </tbody>
      <tfoot>
        <tr className={reportTotalRow}>
          <td className={reportCell} colSpan={4}>
            總計 ({data.customerStats.length} 位會員)
          </td>
          <td className={`${reportCell} text-right font-mono`}>
            {data.customerStats.reduce((s, r) => s + r.billCount, 0)}
          </td>
          <td className={reportCell} colSpan={3} />
          <td className={`${reportCell} text-right font-mono`}>
            {fmtAmt(data.customerStats.reduce((s, r) => s + r.netSpendHkd, 0))}
          </td>
        </tr>
      </tfoot>
    </table>
  ) : tab === "staff" ? (
    <table className={reportTable}>
      <thead className="sticky top-0">
        <tr className={reportHeader}>
          <th className="px-2 py-1 font-bold">職員編號</th>
          <th className="px-2 py-1 font-bold">職員姓名</th>
          <th className="px-2 py-1 text-right font-bold">單數</th>
          <th className="px-2 py-1 text-right font-bold">取消單</th>
          <th className="px-2 py-1 text-right font-bold">單折前額</th>
          <th className="px-2 py-1 text-right font-bold">折扣額</th>
          <th className="px-2 py-1 text-right font-bold">退貨額</th>
          <th className="px-2 py-1 text-right font-bold">淨銷售額</th>
        </tr>
      </thead>
      <tbody>
        {data.staffStats.map((row, index) => (
          <tr key={`${row.staffId}-${row.legacyId}`} className={index % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
            <td className={`${reportCell} font-mono`}>{row.legacyId}</td>
            <td className={reportCell}>{row.displayName}</td>
            <td className={`${reportCell} text-right font-mono`}>{row.billCount}</td>
            <td className={`${reportCell} text-right font-mono`}>{row.voidCount}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.grossSalesHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.discountsHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.returnHkd)}</td>
            <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(row.netSalesHkd)}</td>
          </tr>
        ))}
        {data.staffStats.length === 0 ? (
          <tr>
            <td colSpan={8} className="p-6 text-center text-[#808080]">
              此期間暫無職員銷售統計
            </td>
          </tr>
        ) : null}
      </tbody>
      <tfoot>
        <tr className={reportTotalRow}>
          <td className={reportCell} colSpan={2}>
            總計 ({data.staffStats.length} 位職員)
          </td>
          <td className={`${reportCell} text-right font-mono`}>
            {data.staffStats.reduce((s, r) => s + r.billCount, 0)}
          </td>
          <td className={`${reportCell} text-right font-mono`}>
            {data.staffStats.reduce((s, r) => s + r.voidCount, 0)}
          </td>
          <td className={`${reportCell} text-right font-mono`}>
            {fmtAmt(data.staffStats.reduce((s, r) => s + r.grossSalesHkd, 0))}
          </td>
          <td className={`${reportCell} text-right font-mono`}>
            {fmtAmt(data.staffStats.reduce((s, r) => s + r.discountsHkd, 0))}
          </td>
          <td className={`${reportCell} text-right font-mono`}>
            {fmtAmt(data.staffStats.reduce((s, r) => s + r.returnHkd, 0))}
          </td>
          <td className={`${reportCell} text-right font-mono`}>
            {fmtAmt(data.staffStats.reduce((s, r) => s + r.netSalesHkd, 0))}
          </td>
        </tr>
      </tfoot>
    </table>
  ) : tab === "doctypes" ? (
    <table className={reportTable}>
      <thead className="sticky top-0">
        <tr className={reportHeader}>
          <th className="px-2 py-1 font-bold">單據類型</th>
          <th className="px-2 py-1 font-bold">交易名稱</th>
          <th className="px-2 py-1 text-right font-bold">XC</th>
          <th className="px-2 py-1 text-right font-bold">單據數量</th>
          <th className="px-2 py-1 text-right font-bold">單面總額</th>
          <th className="px-2 py-1 text-right font-bold">加減後淨額</th>
        </tr>
      </thead>
      <tbody>
        {data.docTypeStats.map((row, index) => (
          <tr key={row.docType} className={index % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
            <td className={`${reportCell} font-mono font-bold`}>{row.docType}</td>
            <td className={reportCell}>{row.docTypeLabel}</td>
            <td className={`${reportCell} text-right font-mono`}>{row.legacyXc}</td>
            <td className={`${reportCell} text-right font-mono`}>{row.docCount}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.totalAmountHkd)}</td>
            <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(row.signedAmountHkd)}</td>
          </tr>
        ))}
        {data.docTypeStats.length === 0 ? (
          <tr>
            <td colSpan={6} className="p-6 text-center text-[#808080]">
              此期間暫無交易及損耗紀錄
            </td>
          </tr>
        ) : null}
      </tbody>
      <tfoot>
        <tr className={reportTotalRow}>
          <td className={reportCell} colSpan={3}>
            總計
          </td>
          <td className={`${reportCell} text-right font-mono`}>
            {data.docTypeStats.reduce((s, r) => s + r.docCount, 0)}
          </td>
          <td className={`${reportCell} text-right font-mono`}>
            {fmtAmt(data.docTypeStats.reduce((s, r) => s + r.totalAmountHkd, 0))}
          </td>
          <td className={`${reportCell} text-right font-mono`}>
            {fmtAmt(data.docTypeStats.reduce((s, r) => s + r.signedAmountHkd, 0))}
          </td>
        </tr>
      </tfoot>
    </table>
  ) : tab === "suppliers" ? (
    <table className={reportTable}>
      <thead className="sticky top-0">
        <tr className={reportHeader}>
          <th className="px-2 py-1 font-bold">供應商編號</th>
          <th className="px-2 py-1 font-bold">供應商名稱</th>
          <th className="px-2 py-1 font-bold">電話</th>
          <th className="px-2 py-1 text-right font-bold">到貨單數</th>
          <th className="px-2 py-1 text-right font-bold">退商單數</th>
          <th className="px-2 py-1 text-right font-bold">淨入貨數量</th>
          <th className="px-2 py-1 text-right font-bold">到貨總額</th>
          <th className="px-2 py-1 text-right font-bold">退貨總額</th>
          <th className="px-2 py-1 text-right font-bold">淨採購額</th>
        </tr>
      </thead>
      <tbody>
        {data.supplierStats.map((row, index) => (
          <tr key={row.legacyId} className={index % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
            <td className={`${reportCell} font-mono`}>{row.legacyId}</td>
            <td className={reportCell}>{row.nameZh || row.nameEn}</td>
            <td className={`${reportCell} font-mono`}>{row.phone || "-"}</td>
            <td className={`${reportCell} text-right font-mono`}>{row.grcCount}</td>
            <td className={`${reportCell} text-right font-mono`}>{row.prcCount}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtQty(row.netQty)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.purchaseHkd)}</td>
            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.returnHkd)}</td>
            <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(row.netPurchaseHkd)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className={reportTotalRow}>
          <td className={reportCell} colSpan={3}>
            總計 ({data.supplierStats.length} 間供應商)
          </td>
          <td className={`${reportCell} text-right font-mono`}>
            {data.supplierStats.reduce((s, r) => s + r.grcCount, 0)}
          </td>
          <td className={`${reportCell} text-right font-mono`}>
            {data.supplierStats.reduce((s, r) => s + r.prcCount, 0)}
          </td>
          <td className={`${reportCell} text-right font-mono`}>
            {fmtQty(data.supplierStats.reduce((s, r) => s + r.netQty, 0))}
          </td>
          <td className={`${reportCell} text-right font-mono`}>
            {fmtAmt(data.supplierStats.reduce((s, r) => s + r.purchaseHkd, 0))}
          </td>
          <td className={`${reportCell} text-right font-mono`}>
            {fmtAmt(data.supplierStats.reduce((s, r) => s + r.returnHkd, 0))}
          </td>
          <td className={`${reportCell} text-right font-mono`}>
            {fmtAmt(data.supplierStats.reduce((s, r) => s + r.netPurchaseHkd, 0))}
          </td>
        </tr>
      </tfoot>
    </table>
  ) : (
    <table className={reportTable}>
      <thead className="sticky top-0">
        <tr className={reportHeader}>
          <th className="px-2 py-1 font-bold">日誌ID</th>
          <th className="px-2 py-1 font-bold">操作時間 (HKT)</th>
          <th className="px-2 py-1 font-bold">職員</th>
          <th className="px-2 py-1 font-bold">動作 (Action)</th>
          <th className="px-2 py-1 font-bold">類型</th>
          <th className="px-2 py-1 font-bold">單據 / 編號</th>
          <th className="px-2 py-1 font-bold">內容摘要</th>
        </tr>
      </thead>
      <tbody>
        {data.activityLogs.map((row, index) => (
          <tr key={row.id} className={index % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
            <td className={`${reportCell} font-mono`}>{row.id}</td>
            <td className={`${reportCell} font-mono`}>
              {new Intl.DateTimeFormat("sv-SE", {
                timeZone: "Asia/Hong_Kong",
                dateStyle: "short",
                timeStyle: "medium",
                hour12: false,
              }).format(new Date(row.createdAtIso))}
            </td>
            <td className={reportCell}>
              {row.staffCode} · {row.staffName}
            </td>
            <td className={`${reportCell} font-mono font-bold`}>{row.action}</td>
            <td className={`${reportCell} font-mono`}>{row.entityType}</td>
            <td className={`${reportCell} font-mono`}>{row.entityId}</td>
            <td className={`${reportCell} max-w-md truncate font-mono text-[11px]`}>{row.detailsSummary}</td>
          </tr>
        ))}
        {data.activityLogs.length === 0 ? (
          <tr>
            <td colSpan={7} className="p-6 text-center text-[#808080]">
              暫無系統活動日誌
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
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
            reportTitle={`會員・職員・供應商・系統活動日誌 (${TABS.find((t) => t[0] === tab)?.[1]})`}
            legacyCode="member / staffinfo / supplier / activit"
            subtitle={`期間: ${from} 至 ${to}`}
            shopLabel={shopLabel}
            recordCount={activeCount}
          >
            {tableBody}
          </ReportPaper>
        </div>
      </div>
    );
  }

  return (
    <ReportShell
      title="營業統計"
      legacyCode="member / staffinfo / supplier / activit"
      subtitle={`期間: ${from} 至 ${to}`}
      shopLabel={shopLabel}
      recordCount={activeCount}
      error={error}
      onClose={onClose}
      onRefresh={() => setReloadTick((n) => n + 1)}
      onExportCsv={data ? handleExportCsv : undefined}
      controls={controls}
    >
      {tableBody}
    </ReportShell>
  );
}

export function ManagerStatsReport({ onClose }: { onClose: () => void }) {
  return <ManagerStatsPanel onClose={onClose} />;
}
