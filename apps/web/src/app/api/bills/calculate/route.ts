import { NextResponse } from "next/server";
import { IssueBillOrInvoiceInputSchema } from "@hkharp/contracts";
import { calculateBillTotals, calculateCrmPoints, createIssuedInvoice } from "@hkharp/domain";

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = IssueBillOrInvoiceInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  const totals = calculateBillTotals(
    parsed.data.lines.map((line, i) => ({
      sku: line.sku,
      quantity: line.quantity,
      unitPriceHkd: line.unitPriceHkd,
      discountRate: line.discountRate,
      lineDiscountAmountHkd: line.lineDiscountAmountHkd,
      dk: i + 1,
    })),
  );

  const crm = calculateCrmPoints(
    parsed.data.lines.map((line, idx) => ({
      sku: line.sku,
      categoryC1: line.categoryC1,
      quantity: line.quantity,
      lineNetAmountHkd: totals.lines[idx]?.netHkd ?? 0,
      excludeFromCrmBonus: line.excludeFromCrmBonus,
    })),
    parsed.data.customerCurrentPoints,
  );

  if (!crm.redemptionAllowed) {
    return NextResponse.json({ error: crm.redemptionError }, { status: 422 });
  }

  const nowIso = new Date().toISOString();
  const invoice = createIssuedInvoice({
    invoiceNo: `${parsed.data.docType === "SALES_INVOICE" ? "INV" : "POS"}-${String(parsed.data.shopId).padStart(2, "0")}${String(parsed.data.terminalId).padStart(2, "0")}-PREVIEW`,
    docType: parsed.data.docType,
    netAmountHkd: totals.netAmountHkd,
    issuedAtIso: nowIso,
    initialPayments: parsed.data.initialPayments.map((p) => ({
      tenderCode: p.tenderCode,
      amountHkd: p.amountHkd,
      paidAtIso: p.paidAtIso ?? nowIso,
      referenceNo: p.referenceNo,
    })),
  });

  return NextResponse.json({ totals, crm, invoice });
}
