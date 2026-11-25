"use client";

import { useState } from "react";
import Link from "next/link";
import { formatHkd } from "@hkharp/domain/money";
import { PrintButton } from "@/components/PrintButton";
import { ReceiptPreview, type ReceiptDetail } from "@/components/ReceiptPreview";

export function PrintableDocumentView({ detail }: { detail: ReceiptDetail }) {
  const [format, setFormat] = useState<"a4" | "a5_harp" | "thermal">("a4");
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
              onClick={() => setFormat("a5_harp")}
              className={`rounded-md px-3 py-1 font-medium ${
                format === "a5_harp" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              A5 Harp Invoice (Legacy)
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
      ) : format === "a5_harp" ? (
        <div
          className="mx-auto w-[148mm] min-h-[210mm] border border-slate-300 bg-white p-6 text-[10pt] leading-snug text-black print:border-0"
          style={{ fontFamily: "'Times New Roman', serif" }}
        >
          <div className="flex items-start justify-between border-b border-black pb-3">
            <div>
              <div className="text-[24pt] font-normal leading-none">Harp Invoice</div>
              <div className="mt-1 text-[11pt] font-bold tracking-wider">HONG KONG HARP CENTRE LTD.</div>
              <div className="text-[9pt]">2016, 2/F, United Center, 95 Queensway, Admiralty, Hong Kong</div>
              <div className="text-[9pt]">www.hkHarpCentre.com · HongKongHarpCentre@gmail.com</div>
              <div className="text-[9pt]">Tel: 25293039 · Fax: 25297989</div>
            </div>
            <div className="text-right text-[11pt]">
              <div><span className="font-bold">BILLNO:</span> {bill.invoiceNo}</div>
              <div><span className="font-bold">XTDT:</span> {bill.issuedAtIso.slice(0, 10)}</div>
              <div><span className="font-bold">STATUS:</span> {bill.paymentStatus.toUpperCase()}</div>
            </div>
          </div>

          <div className="my-2 border-b border-slate-400 pb-2 text-[10pt]">
            <div>
              <span className="font-bold">CUST: </span>
              {bill.customer ? `${bill.customer.nameEn || bill.customer.nameZh} (${bill.customer.legacyId}) ${bill.customer.phone ? `· Tel: ${bill.customer.phone}` : ""}` : "Walk-in Customer"}
            </div>
            {bill.customer?.address ? (
              <div className="mt-0.5 text-[9.5pt]">
                <span className="font-bold">ADDR: </span>
                {bill.customer.address}
              </div>
            ) : null}
          </div>

          <table className="w-full border-collapse text-[10pt]">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-1 font-normal">Qty</th>
                <th className="py-1 font-normal">Description</th>
                <th className="py-1 text-right font-normal">Unit Price</th>
                <th className="py-1 text-right font-normal">Total</th>
                <th className="py-1 pl-2 text-right font-normal">貨碼 (UBC)</th>
              </tr>
            </thead>
            <tbody>
              {lines
                .filter((l) => !l.cancelled && l.dk > 0)
                .map((l) => (
                  <tr key={l.lineNo} className="border-b border-slate-200 align-top">
                    <td className="py-1">{l.quantity}</td>
                    <td className="py-1">
                      <div>
                        {l.nameEn || l.nameZh}
                        {l.colorName ? <span className="ml-1 text-[9pt] text-slate-600">({l.colorName})</span> : null}
                      </div>
                      {l.serialNo ? <div className="font-mono text-[9pt]">S/N: {l.serialNo}</div> : null}
                      {l.notes ? <div className="whitespace-pre-wrap text-[9pt] text-slate-700">{l.notes}</div> : null}
                    </td>
                    <td className="py-1 text-right">{formatHkd(l.unitPriceHkd)}</td>
                    <td className="py-1 text-right">{formatHkd(l.lineTotalHkd)}</td>
                    <td className="py-1 pl-2 text-right font-mono text-[8.5pt]">{l.ubc || l.sku}</td>
                  </tr>
                ))}
            </tbody>
          </table>

          <div className="mt-4 flex justify-end border-t border-black pt-2 text-[10.5pt]">
            <div className="w-60 space-y-0.5">
              <div className="flex justify-between"><span>Gross Total:</span><span>{formatHkd(bill.grossAmountHkd)}</span></div>
              <div className="flex justify-between"><span>Discount:</span><span>-{formatHkd(bill.discountAmountHkd)}</span></div>
              <div className="flex justify-between border-t border-black pt-0.5 text-[12pt] font-bold"><span>Net Total:</span><span>{formatHkd(bill.netAmountHkd)}</span></div>
              <div className="flex justify-between"><span>Paid:</span><span>{formatHkd(bill.paidAmountHkd)}</span></div>
              <div className="flex justify-between"><span>Balance:</span><span>{formatHkd(bill.balanceDueHkd)}</span></div>
            </div>
          </div>

          <div className="mt-4 border-t border-slate-400 pt-2 text-[8.5pt] leading-snug">
            <div className="font-bold">Terms:</div>
            <div>In case of disputes, Hong Kong Harp Centre reserves the right to make the final decision.</div>
            <div>All payment non-refundable · Full payment must settled before delivery</div>
          </div>

          <div className="mt-3 border border-slate-400 p-2 text-[8.5pt]">
            <div className="font-bold">Bank Name: Hang Seng Bank LTD</div>
            <div>Bank Address: Head Office. 83 Des Voeux Road Central. H.K.</div>
            <div>Swift Code: HASE HKHH · Bank Code: 024</div>
            <div>Beneficiary A/C Name: Hong Kong Harp Centre Ltd. · Beneficiary A/C No.: 395-417017-883</div>
          </div>

          <div className="mt-4 text-center">
            <div
              className="mx-auto h-10 w-64"
              style={{ background: "repeating-linear-gradient(90deg,#000 0,#000 2px,#fff 2px,#fff 4px,#000 4px,#000 5px,#fff 5px,#fff 8px)" }}
            />
            <div className="mt-1 font-mono text-[9pt] tracking-[0.2em]">{bill.invoiceNo}</div>
          </div>
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
              {bill.customer.address ? <div>Address: {bill.customer.address}</div> : null}
            </div>
          ) : null}

          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-600">
                <th className="py-2">#</th>
                <th className="py-2">Code / Description</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Unit Price</th>
                <th className="py-2 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines
                .filter((l) => !l.cancelled && l.dk > 0)
                .map((l) => (
                  <tr key={l.lineNo} className="align-top">
                    <td className="py-2 font-mono text-slate-500">{l.lineNo}</td>
                    <td className="py-2">
                      <div className="font-medium text-slate-900">
                        {l.nameEn || l.nameZh}
                        {l.colorName ? <span className="ml-1 text-slate-500">({l.colorName})</span> : null}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {l.ubc ? `${l.ubc} (${l.sku})` : l.sku}
                      </div>
                      {l.serialNo ? <div className="text-[11px] font-mono text-slate-700">S/N: {l.serialNo}</div> : null}
                      {l.notes ? <div className="whitespace-pre-wrap text-[11px] text-slate-700">{l.notes}</div> : null}
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
