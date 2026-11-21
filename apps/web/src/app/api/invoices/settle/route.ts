import { NextResponse } from "next/server";
import { SettleInvoiceInputSchema } from "@hkharp/contracts";
import { settleInvoicePayment, type InvoiceState } from "@hkharp/domain";
import { z } from "zod";

const SettleBodySchema = SettleInvoiceInputSchema.extend({
  currentInvoice: z.object({
    invoiceNo: z.string(),
    docType: z.enum(["RETAIL_SALE", "SALES_INVOICE", "SALES_RETURN", "PETTY_PAYOUT"]),
    status: z.enum(["open", "held", "intraday", "completed", "cancelled"]),
    paymentStatus: z.enum(["unpaid", "partial", "paid", "voided"]),
    netAmountHkd: z.number(),
    paidAmountHkd: z.number(),
    balanceDueHkd: z.number(),
    issuedAtIso: z.string(),
    paidAtIso: z.string().optional(),
    payments: z.array(
      z.object({
        tenderCode: z.enum([
          "CASH",
          "OCTOPUS",
          "VISA",
          "MASTERCARD",
          "UNIONPAY",
          "BANK_XFER",
          "AMEX",
          "CHEQUE",
        ]),
        amountHkd: z.number(),
        paidAtIso: z.string(),
        referenceNo: z.string().optional(),
      }),
    ),
  }),
});

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = SettleBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const updated: InvoiceState = settleInvoicePayment(parsed.data.currentInvoice, {
      tenderCode: parsed.data.payment.tenderCode,
      amountHkd: parsed.data.payment.amountHkd,
      paidAtIso: parsed.data.payment.paidAtIso ?? new Date().toISOString(),
      referenceNo: parsed.data.payment.referenceNo,
    });
    return NextResponse.json({ invoice: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Settlement error" },
      { status: 422 },
    );
  }
}
