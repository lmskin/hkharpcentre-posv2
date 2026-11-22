"use client";

import { useState } from "react";
import Link from "next/link";
import { formatHkd } from "@hkharp/domain/money";
import { PrintButton } from "@/components/PrintButton";
import { ReceiptPreview, type ReceiptDetail } from "@/components/ReceiptPreview";

export function PrintableDocumentView({ detail }: { detail: ReceiptDetail }) {
  const [format, setFormat] = useState<"a4" | "thermal">("a4");
  const { bill, lines, payments, settings } = detail;
  const shopProfile = (settings.shop_profile ?? {}) as Record<string, string>;
  const bankInfo = (settings.invoice_payment_instructions ?? {}) as Record<string, string>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-xs print:border-0 print:p-0 print:shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/invoices" className="text-xs font-medium text-indigo-600 hover:underline">
          ← Back to Invoices &amp; AR
        </Link>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 bg-slate-50 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setFormat("a4")}
              className={`rounded-md px-3 py-1 font-medium ${
                format === "a4" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              A4 Formal Invoice
            </button>
            <button
              type="button"
              onClick={() => setFormat("thermal")}
              className={`rounded-md px-3 py-1 font-medium ${
                format === "thermal" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              80mm Thermal Receipt
            </button>
          </div>
          <PrintButton />
        </div>
      </div>

      {format === "thermal" ? (
        <div className="rounded-lg bg-slate-100 p-4 print:bg-white print:p-0">
          <ReceiptPreview detail={detail} />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between border-b border-slate-200 pb-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                {shopProfile.nameEn ?? "Hong Kong Harp Centre"}
              </h1>
              <div className="text-sm text-slate-600">{shopProfile.nameZh ?? "香港豎琴中心"}</div>
              <div className="mt-1 text-xs text-slate-500">{shopProfile.addressEn ?? "Central, Hong Kong"}</div>
            </div>
            <div className="text-right">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                {bill.docType === "SALES_INVOICE" ? "Sales Invoice" : "Sales Receipt"}
              </div>
              <div className="mt-1 font-mono text-lg font-bold text-slate-900">{bill.invoiceNo}</div>
              <div className="text-xs text-slate-600">Issued: {bill.issuedAtIso.slice(0, 10)}</div>
              <div className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-800">
                {bill.paymentStatus}
              </div>
            </div>
          </div>

          {bill.customer ? (
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
              <div className="font-semibold text-slate-900">Bill To:</div>
              <div>
                {bill.customer.nameEn || bill.customer.nameZh} ({bill.customer.legacyId})
              </div>
              {bill.customer.phone ? <div>Tel: {bill.customer.phone}</div> : null}
            </div>
          ) : null}

          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-600">
                <th className="py-2">#</th>
                <th className="py-2">SKU / Description</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Unit Price</th>
                <th className="py-2 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines
                .filter((l) => !l.cancelled && l.dk > 0)
                .map((l) => (
                  <tr key={l.lineNo}>
                    <td className="py-2 font-mono text-slate-500">{l.lineNo}</td>
                    <td className="py-2">
                      <div className="font-medium text-slate-900">{l.nameEn || l.nameZh}</div>
                      <div className="text-[11px] text-slate-500">{l.sku}</div>
                    </td>
                    <td className="py-2 text-right font-mono">{l.quantity}</td>
                    <td className="py-2 text-right font-mono">{formatHkd(l.unitPriceHkd)}</td>
                    <td className="py-2 text-right font-mono font-semibold">{formatHkd(l.lineTotalHkd)}</td>
                  </tr>
                ))}
            </tbody>
          </table>

          <div className="flex justify-end border-t border-slate-200 pt-4">
            <div className="w-64 space-y-1 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Gross Total</span>
                <span className="font-mono">{formatHkd(bill.grossAmountHkd)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Discount</span>
                <span className="font-mono">-{formatHkd(bill.discountAmountHkd)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1 text-sm font-bold text-slate-900">
                <span>Net Invoice Total</span>
                <span className="font-mono">{formatHkd(bill.netAmountHkd)}</span>
              </div>
              <div className="flex justify-between text-emerald-700">
                <span>Paid to Date</span>
                <span className="font-mono">{formatHkd(bill.paidAmountHkd)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1 text-sm font-bold text-amber-800">
                <span>Balance Due</span>
                <span className="font-mono">{formatHkd(bill.balanceDueHkd)}</span>
              </div>
            </div>
          </div>

          {payments.length > 0 ? (
            <div className="border-t border-slate-200 pt-3 text-xs">
              <div className="font-semibold text-slate-700">Recorded Payments</div>
              <ul className="mt-1 space-y-1">
                {payments.map((p, idx) => (
                  <li key={idx} className="flex justify-between text-slate-600">
                    <span>
                      {p.tenderCode} · {p.paidAtIso.slice(0, 10)}{" "}
                      {p.referenceNo ? `(Ref: ${p.referenceNo})` : p.cardLast4 ? `(****${p.cardLast4})` : ""}
                    </span>
                    <span className="font-mono font-medium">{formatHkd(p.amountHkd)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
            <div className="font-semibold text-slate-900">Bank Transfer Payment Instructions</div>
            <div className="mt-1">Payee: {bankInfo.payeeName ?? "Hong Kong Harp Centre Limited"}</div>
            <div>Bank: {bankInfo.bankName ?? "HSBC Hong Kong"}</div>
            <div>Account No.: {bankInfo.accountNumber ?? "See settings"}</div>
            <div>FPS ID: {bankInfo.fpsId ?? "See settings"}</div>
            <div className="mt-1 text-slate-500">
              {bankInfo.paymentTermsNote ?? `Please quote Invoice ${bill.invoiceNo} on your transfer reference.`}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
