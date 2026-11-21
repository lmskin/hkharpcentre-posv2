"use client";

import { useEffect, useState } from "react";
import { formatHkd } from "@hkharp/domain/money";

interface DayEndPreview {
  businessDate: string;
  billCount: number;
  issuedSalesTotalHkd: number;
  unpaidIssuedBalanceHkd: number;
  collectedByTender: Array<{
    tenderCode: string;
    txCount: number;
    collectedAmountHkd: number;
  }>;
  recentBatches: Array<{
    id: number;
    businessDate: string;
    batchNo: number;
    status: string;
    issuedSalesTotalHkd: number;
    collectedPaymentsTotalHkd: number;
    closedAtIso: string | null;
  }>;
}

export default function DayEndBackOfficePage() {
  const [date, setDate] = useState(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date()),
  );
  const [preview, setPreview] = useState<DayEndPreview | null>(null);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  async function loadPreview(d: string) {
    const res = await fetch(`/api/day-end?date=${encodeURIComponent(d)}`);
    if (res.ok) {
      const data = (await res.json()) as DayEndPreview;
      setPreview(data);
    }
  }

  useEffect(() => {
    void loadPreview(date);
  }, [date]);

  async function closeShift() {
    if (!preview) return;
    setMsg("");
    const res = await fetch("/api/day-end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessDate: date,
        countedByTender: preview.collectedByTender.map((t) => ({
          tenderCode: t.tenderCode,
          countedAmountHkd:
            counted[t.tenderCode] !== undefined && counted[t.tenderCode] !== ""
              ? Number(counted[t.tenderCode])
              : t.collectedAmountHkd,
        })),
      }),
    });
    const data = (await res.json()) as { ok?: boolean; batchNo?: number; error?: string };
    if (!res.ok) {
      setMsg(data.error ?? "Failed to close batch (requires L4+ login)");
      return;
    }
    setMsg(`Closed Day-End Batch #${data.batchNo} for ${date}.`);
    await loadPreview(date);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Day-End Shift Close &amp; Reconciliation</h1>
            <p className="text-xs text-slate-500">
              Separates issued sales revenue (issued_at) from actual collected tenders (paid_at).
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded border border-slate-300 px-2.5 py-1.5"
            />
            <button
              type="button"
              onClick={() => void closeShift()}
              className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white hover:bg-slate-800"
            >
              Close Shift Batch
            </button>
          </div>
        </div>

        {msg ? <div className="mt-3 rounded bg-slate-50 p-2 text-xs text-slate-800">{msg}</div> : null}

        {preview ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="text-xs text-slate-500">Issued Bills ({preview.billCount})</div>
              <div className="mt-1 font-mono text-lg font-bold text-slate-900">
                {formatHkd(preview.issuedSalesTotalHkd)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="text-xs text-slate-500">Still Unpaid / Invoice AR Created</div>
              <div className="mt-1 font-mono text-lg font-bold text-amber-700">
                {formatHkd(preview.unpaidIssuedBalanceHkd)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="text-xs text-slate-500">Collected Tenders (paid_at = {date})</div>
              <div className="mt-1 font-mono text-lg font-bold text-emerald-700">
                {formatHkd(
                  preview.collectedByTender.reduce((s, t) => s + t.collectedAmountHkd, 0),
                )}
              </div>
            </div>
          </div>
        ) : null}

        {preview && preview.collectedByTender.length > 0 ? (
          <table className="mt-4 w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2">Tender</th>
                <th className="py-2 text-right">Tx Count</th>
                <th className="py-2 text-right">System Expected</th>
                <th className="py-2 text-right">Counted Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {preview.collectedByTender.map((t) => (
                <tr key={t.tenderCode}>
                  <td className="py-2 font-mono font-semibold">{t.tenderCode}</td>
                  <td className="py-2 text-right font-mono">{t.txCount}</td>
                  <td className="py-2 text-right font-mono">{formatHkd(t.collectedAmountHkd)}</td>
                  <td className="py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      placeholder={String(t.collectedAmountHkd)}
                      value={counted[t.tenderCode] ?? ""}
                      onChange={(e) => setCounted((p) => ({ ...p, [t.tenderCode]: e.target.value }))}
                      className="w-32 rounded border border-slate-300 px-2 py-1 text-right font-mono"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-4 text-xs text-slate-500">No payments collected on {date} yet.</p>
        )}
      </section>

      {preview ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <h2 className="text-sm font-bold text-slate-900">Recent Closed Batches (V47 + V2)</h2>
          <table className="mt-3 w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2">Business Date</th>
                <th className="py-2">Batch #</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Collected Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {preview.recentBatches.map((b) => (
                <tr key={b.id}>
                  <td className="py-2 font-mono">{b.businessDate}</td>
                  <td className="py-2 font-mono">{b.batchNo}</td>
                  <td className="py-2 uppercase">{b.status}</td>
                  <td className="py-2 text-right font-mono">{formatHkd(b.collectedPaymentsTotalHkd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
