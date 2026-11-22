"use client";

import type { ReactNode } from "react";

export function currentBusinessDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date());
}

export function currentHktTimestamp() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

/**
 * Formats numbers cleanly for CSV export (matching legacy eRunBOS.ReportItem.RptValue:
 * strip currency symbols like "HK$" and commas so Excel opens numeric cells cleanly).
 */
function sanitizeCsvCell(cell: string | number | null | undefined): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
  const raw = String(cell).trim();
  if (/^-?HK\$[\d,.-]+$/i.test(raw)) {
    return raw.replace(/HK\$/gi, "").replace(/,/g, "");
  }
  return raw;
}

export function downloadCsvFile(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const escaped = rows
    .map((row) =>
      row
        .map((cell) => {
          const text = sanitizeCsvCell(cell);
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(","),
    )
    .join("\n");
  const blob = new Blob([`\uFEFF${escaped}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function fmtAmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function fmtQty(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString("en-US")
    : new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
}

export function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

export const VB_FONT = "Tahoma, 'Microsoft JhengHei', 'PMingLiU', sans-serif";
export const reportTable = "legacy-report-table w-full border-collapse text-[12px] text-black";
export const reportHeader = "bg-[#e8eef5] text-left text-black border-b-2 border-[#7f9db9]";
export const reportCell = "border-b border-[#d4d0c8] px-2 py-1";
export const reportSubTotalRow = "bg-[#eef3fb] font-bold text-[#1d3f72] border-t border-[#7f9db9]";
export const reportTotalRow = "bg-[#ffffe1] font-bold text-black border-t-2 border-b-2 border-[#7f9db9]";
export const reportInput = "border border-[#7f9db9] bg-white px-2 py-0.5 text-[12px] text-black";
export const reportBtn =
  "border border-[#7f9db9] bg-[#f0f0f0] px-3 py-1 text-[12px] text-black hover:bg-[#e5e1d5] disabled:cursor-not-allowed disabled:opacity-40";

export function LegacyPrintBanner({
  reportTitle,
  legacyCode,
  subtitle,
  shopLabel = "Central(1)",
  recordCount,
}: {
  reportTitle: string;
  legacyCode?: string;
  subtitle?: string;
  shopLabel?: string;
  recordCount?: number;
}) {
  const printedAt = currentHktTimestamp();
  return (
    <div className="border-b-2 border-[#316ac5] bg-[#fafcff] px-3 py-2 text-[11px] text-black">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-bold text-[#1d3f72]">
          HONG KONG HARP CENTRE · 店舖: {shopLabel}
          {legacyCode ? <span className="ml-2 font-mono font-normal text-[#666]">[{legacyCode}]</span> : null}
        </div>
        <div className="font-mono text-[#333]">編印 Printed: {printedAt}</div>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[14px] font-bold tracking-wide text-black">{reportTitle}</div>
        <div className="text-[#333]">
          {subtitle ? <span className="font-mono">{subtitle}</span> : null}
          {recordCount !== undefined ? <span className="ml-3">紀錄筆數: {recordCount}</span> : null}
        </div>
      </div>
    </div>
  );
}

export function LegacyPrintFooter({ recordCount }: { recordCount?: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between border-t border-[#aca899] bg-[#f8f9fb] px-3 py-1.5 text-[11px] text-[#333]">
      <span>營運通報表  版權©2001-2009。 (An eRun Report)</span>
      <span className="font-mono">
        {recordCount !== undefined ? `共 ${recordCount} 筆紀錄 · ` : ""}完 (End)
      </span>
    </div>
  );
}

export function ReportPaper({
  reportTitle,
  legacyCode,
  subtitle,
  shopLabel,
  recordCount,
  children,
}: {
  reportTitle: string;
  legacyCode?: string;
  subtitle?: string;
  shopLabel?: string;
  recordCount?: number;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col bg-white text-black">
      <LegacyPrintBanner
        reportTitle={reportTitle}
        legacyCode={legacyCode}
        subtitle={subtitle}
        shopLabel={shopLabel}
        recordCount={recordCount}
      />
      <div className="flex-1">{children}</div>
      <LegacyPrintFooter recordCount={recordCount} />
    </div>
  );
}

export function ReportShell({
  title,
  legacyCode,
  subtitle,
  shopLabel = "Central(1)",
  recordCount,
  mode = "modal",
  controls,
  children,
  error,
  onExportCsv,
  onRefresh,
  onClose,
}: {
  title: string;
  legacyCode?: string;
  subtitle?: string;
  shopLabel?: string;
  recordCount?: number;
  mode?: "modal" | "page";
  controls?: ReactNode;
  children: ReactNode;
  error?: string;
  onExportCsv?: () => void;
  onRefresh?: () => void;
  onClose?: () => void;
}) {
  const frame = (
    <div
      className="legacy-report-print-root flex h-full flex-col border border-[#808080] bg-[#f0f0f0] text-black shadow-[4px_4px_8px_rgba(0,0,0,0.4)]"
      style={{ fontFamily: VB_FONT }}
    >
      <div className="print-hide flex items-center border-b border-[#d4d0c8] px-2 py-1 text-[12px] font-bold text-black">
        <span>{mode === "modal" ? `經理 - ${title}` : `BOSMaint / ReportG - ${title}`}</span>
        {legacyCode ? <span className="ml-auto font-mono text-[11px] font-normal text-[#555]">{legacyCode}</span> : null}
      </div>
      <div className="print-hide flex flex-wrap items-center gap-2 border-b border-[#aca899] p-2 text-[12px] text-black">
        {controls}
        <div className="ml-auto flex items-center gap-1.5">
          {onRefresh ? (
            <button type="button" onClick={onRefresh} className={reportBtn}>
              執行查詢
            </button>
          ) : null}
          {onExportCsv ? (
            <button type="button" onClick={onExportCsv} className={reportBtn}>
              匯出 CSV
            </button>
          ) : null}
          <button type="button" onClick={() => window.print()} className={reportBtn}>
            列印預覽
          </button>
        </div>
      </div>
      <div className="legacy-report-scroll min-h-0 flex-1 overflow-auto bg-white">
        <ReportPaper
          reportTitle={title}
          legacyCode={legacyCode}
          subtitle={subtitle}
          shopLabel={shopLabel}
          recordCount={recordCount}
        >
          {children}
        </ReportPaper>
      </div>
      {error ? (
        <div className="print-hide border-t border-[#aca899] bg-[#ffffe1] px-2 py-1 text-[12px] text-[#c00000]">
          營運通訊息 - 053：{error}
        </div>
      ) : null}
      {mode === "modal" && onClose ? (
        <div className="print-hide flex justify-end border-t border-[#aca899] p-2">
          <button
            type="button"
            autoFocus
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
    return <div className="min-h-[680px]">{frame}</div>;
  }

  return (
    <div className="absolute inset-0 z-20 bg-black/10 p-3" role="dialog" aria-modal="true" aria-label={title}>
      {frame}
    </div>
  );
}
