"use client";

import { useEffect, useState } from "react";
import { HourlyReportPanel } from "./HourlyReport";
import { ItemReportPanel } from "./ItemReport";
import { HistoryReportPanel } from "./HistoryReport";
import { ManagerStatsPanel } from "./ManagerStatsReport";
import { AllPurposeStatView, BosCostView, ShiftDayEndView } from "./LegacySalesAndShiftViews";
import {
  CheckLedgerView,
  OtherTxnReportView,
  StockMovementMatrixView,
  StockValueView,
} from "./LegacyStockAndLedgerViews";
import { VB_FONT } from "./ReportShell";

export type ReportCenterTab =
  | "hourly"
  | "shift"
  | "items"
  | "history"
  | "allstat"
  | "cost"
  | "stock_val"
  | "movement"
  | "check_ledger"
  | "office_tx"
  | "stats";

interface StoreMeta {
  shopId: number;
  legacySn: number;
  shopCode: string;
  shopNameZh: string;
  shopNameEn: string;
  categories: Array<{ legacyC1: number; nameZh: string; nameEn: string }>;
}

const CENTER_TABS: Array<{ id: ReportCenterTab; label: string; code: string }> = [
  { id: "hourly", label: "每日時飛 (時報)", code: "fmdhsales" },
  { id: "shift", label: "每日交更埋數", code: "fmshiftreport" },
  { id: "items", label: "項目銷售 (項報)", code: "listXDetail" },
  { id: "history", label: "歷史營業及月計", code: "ReportM" },
  { id: "allstat", label: "萬用銷售統計", code: "fmAllStat" },
  { id: "cost", label: "10403 成本報表", code: "clsCostSumRpt" },
  { id: "stock_val", label: "10405 存貨價值/呆貨", code: "clsStockValRpt" },
  { id: "movement", label: "10407 存貨變動", code: "Report4" },
  { id: "check_ledger", label: "查單/收款/AR帳齡", code: "wfpayment" },
  { id: "office_tx", label: "其他交易及盤點", code: "OfficeXHeader" },
  { id: "stats", label: "會員/職員/供應商/日誌", code: "activit" },
];

export function LegacyReportCenter({
  mode = "modal",
  initialTab = "allstat",
  onClose,
}: {
  mode?: "modal" | "page";
  initialTab?: ReportCenterTab;
  onClose?: () => void;
}) {
  const [tab, setTab] = useState<ReportCenterTab>(initialTab);
  const [meta, setMeta] = useState<StoreMeta | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    fetch("/api/reports?view=meta")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: StoreMeta | null) => {
        if (body) setMeta(body);
      })
      .catch(() => {});
  }, []);

  const shopLabel = meta ? `${meta.shopNameEn}(${meta.legacySn})` : "Central(1)";
  const categories = meta?.categories ?? [];
  const activeMeta = CENTER_TABS.find((t) => t.id === tab)!;

  const content = (
    <div
      className={`legacy-report-print-root flex flex-col border border-[#808080] bg-[#f0f0f0] text-black shadow-[4px_4px_8px_rgba(0,0,0,0.35)] ${
        mode === "modal" ? "h-full" : "min-h-[760px]"
      }`}
      style={{ fontFamily: VB_FONT }}
    >
      <div className="print-hide flex items-center border-b border-[#d4d0c8] bg-[#e8eef5] px-2 py-1 text-[12px] font-bold text-black">
        <span>營運通報表中心 (ReportG / BOSMaint) · {activeMeta.label}</span>
        <span className="ml-auto font-mono text-[11px] font-normal text-[#333]">
          {shopLabel} · {activeMeta.code}
        </span>
      </div>

      <div className="print-hide flex flex-wrap gap-1 border-b border-[#aca899] bg-[#f0f0f0] px-2 py-1.5 text-[11px]">
        {CENTER_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`border px-2.5 py-1 ${
              tab === item.id
                ? "border-[#316ac5] bg-[#316ac5] font-bold text-white"
                : "border-[#7f9db9] bg-white text-black hover:bg-[#e5e1d5]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "hourly" ? <HourlyReportPanel embedded shopLabel={shopLabel} /> : null}
        {tab === "shift" ? <ShiftDayEndView shopLabel={shopLabel} /> : null}
        {tab === "items" ? <ItemReportPanel embedded shopLabel={shopLabel} categories={categories} /> : null}
        {tab === "history" ? <HistoryReportPanel embedded shopLabel={shopLabel} /> : null}
        {tab === "allstat" ? <AllPurposeStatView shopLabel={shopLabel} /> : null}
        {tab === "cost" ? <BosCostView shopLabel={shopLabel} /> : null}
        {tab === "stock_val" ? <StockValueView shopLabel={shopLabel} categories={categories} /> : null}
        {tab === "movement" ? <StockMovementMatrixView shopLabel={shopLabel} categories={categories} /> : null}
        {tab === "check_ledger" ? <CheckLedgerView shopLabel={shopLabel} /> : null}
        {tab === "office_tx" ? <OtherTxnReportView shopLabel={shopLabel} /> : null}
        {tab === "stats" ? <ManagerStatsPanel embedded shopLabel={shopLabel} /> : null}
      </div>

      {mode === "modal" && onClose ? (
        <div className="print-hide flex items-center justify-between border-t border-[#aca899] px-2 py-1.5 text-[11px] text-[#555]">
          <span>eRun ReportG / BOSMaint Classic Report Workbench</span>
          <button
            type="button"
            onClick={onClose}
            className="border border-[#7f9db9] bg-[#e1dfff] px-7 py-1 text-[12px] text-black hover:bg-[#d0ccff]"
          >
            離開
          </button>
        </div>
      ) : null}
    </div>
  );

  if (mode === "page") {
    return content;
  }

  return (
    <div
      className="absolute inset-0 z-20 bg-black/10 p-2"
      role="dialog"
      aria-modal="true"
      aria-label="營運通報表中心"
    >
      {content}
    </div>
  );
}
