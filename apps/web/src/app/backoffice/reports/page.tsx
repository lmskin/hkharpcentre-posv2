"use client";

import { useEffect, useState } from "react";
import { formatHkd } from "@hkharp/domain/money";

interface ReportsResponse {
  range: { fromDate: string; toDate: string };
  salesByTender: Array<{ tenderCode: string; txCount: number; totalHkd: number }>;
  salesByCategory: Array<{ categoryC1: number; lineCount: number; totalHkd: number }>;
  arAgingSummary: { openInvoices: number; totalBalanceDueHkd: number };
  stockValuation: { positiveSkuCount: number; totalUnits: number; totalValuationHkd: number };
  recentAudits: Array<{ id: number; action: string; entityType: string; entityId: string; createdAtIso: string }>;
}

export default function ReportsBackOfficePage() {
  const [fromDate, setFromDate] = useState("2026-01-01");
  const [toDate, setToDate] = useState("2026-12-31");
  const [report, setReport] = useState<ReportsResponse | null>(null);

  async function fetchReport(f: string, t: string) {
    const res = await fetch(`/api/reports?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`);
    if (res.ok) setReport((await res.json()) as ReportsResponse);
  }

  useEffect(() => {
    void fetchReport(fromDate, toDate);
  }, [fromDate, toDate]);

  function downloadCsv() {
    if (!report) return;
    const rows = [
      ["TenderCode", "TxCount", "TotalHKD"],
      ...report.salesByTender.map((r) => [r.tenderCode, String(r.txCount), String(r.totalHkd)]),
    ];
    const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hkharp-tenders-${fromDate}-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-bold text-slate-900">Operational &amp; Financial Reports</h1>
          <div className="flex items-center gap-2 text-xs">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            />
            <span>to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            />
            <button
              type="button"
              onClick={downloadCsv}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold hover:bg-slate-50"
            >
              Export Tender CSV
            </button>
          </div>
        </div>

        {report ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="text-xs text-slate-500">Open Unpaid Invoice AR Aging</div>
              <div className="mt-1 font-mono text-lg font-bold text-amber-800">
                {report.arAgingSummary.openInvoices.toLocaleString()} invoices ·{" "}
                {formatHkd(report.arAgingSummary.totalBalanceDueHkd)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="text-xs text-slate-500">Inventory Valuation ({report.stockValuation.positiveSkuCount} positive SKUs)</div>
              <div className="mt-1 font-mono text-lg font-bold text-slate-900">
                {formatHkd(report.stockValuation.totalValuationHkd)} ({report.stockValuation.totalUnits} units)
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {report ? (
        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <h2 className="text-sm font-bold text-slate-900">Collections by Tender (PM=3 &rarr; MASTERCARD)</h2>
            <table className="mt-3 w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2">Tender</th>
                  <th className="py-2 text-right">Txns</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.salesByTender.map((t) => (
                  <tr key={t.tenderCode}>
                    <td className="py-2 font-mono font-semibold">{t.tenderCode}</td>
                    <td className="py-2 text-right font-mono">{t.txCount.toLocaleString()}</td>
                    <td className="py-2 text-right font-mono font-semibold">{formatHkd(t.totalHkd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <h2 className="text-sm font-bold text-slate-900">Sales by Category (`C1`)</h2>
            <table className="mt-3 w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2">Category C1</th>
                  <th className="py-2 text-right">Lines</th>
                  <th className="py-2 text-right">Net Sales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.salesByCategory.map((c) => (
                  <tr key={c.categoryC1}>
                    <td className="py-2 font-mono font-semibold">C1={c.categoryC1}</td>
                    <td className="py-2 text-right font-mono">{c.lineCount.toLocaleString()}</td>
                    <td className="py-2 text-right font-mono font-semibold">{formatHkd(c.totalHkd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      ) : null}
    </div>
  );
}
