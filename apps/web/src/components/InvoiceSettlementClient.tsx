"use client";

import { useState } from "react";
import Link from "next/link";
import { formatHkd } from "@hkharp/domain/money";

export interface InvoiceListItem {
  invoiceNo: string;
  docType: string;
  status: string;
  paymentStatus: string;
  customerName?: string;
  netAmountHkd: number;
  paidAmountHkd: number;
  balanceDueHkd: number;
  issuedAtIso: string;
  paidAtIso?: string;
  payments: Array<{
    tenderCode: string;
    amountHkd: number;
    paidAtIso: string;
    referenceNo?: string;
  }>;
}

export function InvoiceSettlementClient({
  initialInvoices,
}: {
  initialInvoices: InvoiceListItem[];
}) {
  const [invoices, setInvoices] = useState<InvoiceListItem[]>(initialInvoices);
  const [statusFilter, setStatusFilter] = useState<"open" | "paid" | "all">("open");
  const [searchQ, setSearchQ] = useState("");
  const [selectedNo, setSelectedNo] = useState<string>(initialInvoices[0]?.invoiceNo ?? "");
  const [tenderCode, setTenderCode] = useState<
    "BANK_XFER" | "CHEQUE" | "CASH" | "VISA" | "MASTERCARD" | "UNIONPAY" | "AMEX"
  >("BANK_XFER");
  const [amountInput, setAmountInput] = useState<string>("");
  const [referenceNo, setReferenceNo] = useState<string>("");
  const [feedback, setFeedback] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const activeInvoice = invoices.find((inv) => inv.invoiceNo === selectedNo) ?? invoices[0];

  const totalIssuedHkd = invoices.reduce((sum, i) => sum + i.netAmountHkd, 0);
  const totalOutstandingHkd = invoices.reduce((sum, i) => sum + i.balanceDueHkd, 0);
  const totalCollectedHkd = invoices.reduce((sum, i) => sum + i.paidAmountHkd, 0);

  async function refreshList(nextStatus: "open" | "paid" | "all", q: string) {
    setStatusFilter(nextStatus);
    setSearchQ(q);
    const res = await fetch(
      `/api/invoices?status=${nextStatus}&q=${encodeURIComponent(q)}&limit=60`,
    );
    if (res.ok) {
      const data = (await res.json()) as { invoices: InvoiceListItem[] };
      setInvoices(data.invoices);
      if (data.invoices.length > 0 && !data.invoices.some((i) => i.invoiceNo === selectedNo)) {
        setSelectedNo(data.invoices[0]!.invoiceNo);
      }
    }
  }

  async function handleSettle(e: React.FormEvent) {
    e.preventDefault();
    if (!activeInvoice) return;
    const payHkd = amountInput ? Number(amountInput) : activeInvoice.balanceDueHkd;
    setSubmitting(true);
    setFeedback("");
    try {
      const res = await fetch(`/api/invoices/${encodeURIComponent(activeInvoice.invoiceNo)}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientIdempotencyKey: `ar-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          tenderCode,
          amountHkd: payHkd,
          referenceNo: referenceNo.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        paymentStatus?: string;
        balanceDueHkd?: number;
        error?: string;
      };
      if (!res.ok) {
        setFeedback(data.error ?? "Settlement failed (check staff login / L2+ permission).");
        return;
      }
      setAmountInput("");
      setReferenceNo("");
      setFeedback(
        `Recorded ${tenderCode} of ${formatHkd(payHkd)} on ${activeInvoice.invoiceNo}. Status: ${(data.paymentStatus ?? "").toUpperCase()} (balance ${formatHkd(data.balanceDueHkd ?? 0)}).`,
      );
      await refreshList(statusFilter, searchQ);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-medium text-slate-500">Listed Invoiced Sales (issued_at)</div>
          <div className="mt-1 font-mono text-xl font-bold text-slate-900">{formatHkd(totalIssuedHkd)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-medium text-slate-500">Collected Receipts (paid_at)</div>
          <div className="mt-1 font-mono text-xl font-bold text-emerald-700">{formatHkd(totalCollectedHkd)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-medium text-slate-500">Open Balance Due (Bank Transfer AR)</div>
          <div className="mt-1 font-mono text-xl font-bold text-amber-700">{formatHkd(totalOutstandingHkd)}</div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1.5 text-xs font-medium">
              {(["open", "paid", "all"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => void refreshList(tab, searchQ)}
                  className={`rounded-md border px-2.5 py-1 capitalize ${
                    statusFilter === tab ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200"
                  }`}
                >
                  {tab === "open" ? "Unpaid / Partial" : tab === "paid" ? "Settled" : "All"}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={searchQ}
              onChange={(e) => void refreshList(statusFilter, e.target.value)}
              placeholder="Search invoice # or notes..."
              className="w-56 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
            />
          </div>

          <div className="mt-3 max-h-[500px] divide-y divide-slate-100 overflow-y-auto">
            {invoices.map((inv) => (
              <div
                key={inv.invoiceNo}
                className={`flex items-center justify-between px-3 py-3 text-sm transition ${
                  activeInvoice?.invoiceNo === inv.invoiceNo ? "bg-indigo-50" : "hover:bg-slate-50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedNo(inv.invoiceNo);
                    setAmountInput(String(inv.balanceDueHkd));
                  }}
                  className="flex-1 text-left"
                >
                  <div className="font-mono font-semibold text-slate-900">{inv.invoiceNo}</div>
                  <div className="text-xs text-slate-500">
                    Issued {inv.issuedAtIso.slice(0, 10)} · {inv.customerName ?? "Customer"} ·{" "}
                    {inv.payments.length} pmt(s)
                  </div>
                </button>
                <div className="flex items-center gap-3 text-right">
                  <div>
                    <div className="font-mono text-xs font-semibold text-slate-900">
                      Bal {formatHkd(inv.balanceDueHkd)}
                    </div>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        inv.paymentStatus === "paid"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {inv.paymentStatus}
                    </span>
                  </div>
                  <Link
                    href={`/invoices/${encodeURIComponent(inv.invoiceNo)}/print`}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                  >
                    Print
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-5">
          <h2 className="text-sm font-semibold text-slate-900">Record Bank Transfer / Cheque Settlement</h2>
          {activeInvoice ? (
            <form onSubmit={(e) => void handleSettle(e)} className="mt-4 space-y-3 text-sm">
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
                <div>
                  Invoice: <span className="font-mono font-semibold">{activeInvoice.invoiceNo}</span>
                </div>
                <div>Net Total: {formatHkd(activeInvoice.netAmountHkd)}</div>
                <div>
                  Balance Due:{" "}
                  <span className="font-mono font-semibold text-amber-800">
                    {formatHkd(activeInvoice.balanceDueHkd)}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">Settlement Tender</label>
                <select
                  value={tenderCode}
                  onChange={(e) =>
                    setTenderCode(
                      e.target.value as "BANK_XFER" | "CHEQUE" | "CASH" | "VISA" | "MASTERCARD" | "UNIONPAY" | "AMEX",
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="BANK_XFER">Bank Transfer (PM=5)</option>
                  <option value="CHEQUE">Cheque (PM=7)</option>
                  <option value="VISA">Visa Standalone (PM=2)</option>
                  <option value="MASTERCARD">MasterCard Standalone (PM=3)</option>
                  <option value="UNIONPAY">UnionPay Standalone (PM=4)</option>
                  <option value="AMEX">AMEX Standalone (PM=6)</option>
                  <option value="CASH">Cash (PM=0)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">Amount Received (HKD)</label>
                <input
                  type="number"
                  step="0.01"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder={String(activeInvoice.balanceDueHkd)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Bank Transfer Ref / Cheque No.
                </label>
                <input
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  placeholder="e.g. HSBC-TT-20261121-001"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={activeInvoice.balanceDueHkd <= 0 || submitting}
                className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-300"
              >
                {submitting ? "Posting to MySQL 8..." : "Post Settlement Payment"}
              </button>

              {feedback ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
                  {feedback}
                </div>
              ) : null}
            </form>
          ) : (
            <p className="mt-3 text-xs text-slate-500">Select an invoice on the left.</p>
          )}
        </section>
      </div>
    </div>
  );
}
