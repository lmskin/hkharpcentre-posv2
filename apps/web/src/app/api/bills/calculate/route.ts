import { NextResponse } from "next/server";
import { IssueBillOrInvoiceInputSchema } from "@hkharp/contracts";
import { getAppSettings } from "@hkharp/db";
import {
  applyPromotionRules,
  calculateBillTotals,
  calculateCrmPoints,
  createIssuedInvoice,
  parsePosRoundSpec,
  posRound,
  type PromotionRule,
} from "@hkharp/domain";

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

  let promoRules: PromotionRule[] = [];
  const rawBody = (raw && typeof raw === "object" ? raw : {}) as {
    promotionRules?: PromotionRule[];
    roundSpec?: string;
  };
  if (Array.isArray(rawBody.promotionRules)) {
    promoRules = rawBody.promotionRules;
  } else {
    try {
      const settings = await getAppSettings();
      const stored = settings.promotion_rules as { rules?: PromotionRule[] } | undefined;
      if (Array.isArray(stored?.rules)) promoRules = stored.rules;
    } catch {
      // Pure stateless calculation fallback when DB unavailable
    }
  }

  const promoResult = applyPromotionRules(
    parsed.data.lines.map((line) => ({
      sku: line.sku,
      categoryC1: line.categoryC1,
      quantity: line.quantity,
      unitPriceHkd: line.unitPriceHkd,
      discountRate: line.discountRate,
    })),
    promoRules,
  );

  const totals = calculateBillTotals(
    parsed.data.lines.map((line, i) => ({
      sku: line.sku,
      quantity: line.quantity,
      unitPriceHkd: line.unitPriceHkd,
      discountRate: promoResult.lines[i]?.discountRate ?? line.discountRate,
      lineDiscountAmountHkd: line.lineDiscountAmountHkd,
      dk: i + 1,
    })),
  );

  const roundRule = parsePosRoundSpec(rawBody.roundSpec ?? "1U");
  const preRoundNet = Math.max(0, totals.netAmountHkd - promoResult.billDiscountHkd);
  const roundedNetAmountHkd = rawBody.roundSpec ? posRound(preRoundNet, roundRule.unit, roundRule.mode) : preRoundNet;

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
    invoiceNo: `${parsed.data.docType === "SALES_INVOICE" ? "INV" : "POS"}-${String(parsed.data.shopId).padStart(2, "0")}${String(parsed.data.terminalId ?? 1).padStart(2, "0")}-PREVIEW`,
    docType: parsed.data.docType,
    netAmountHkd: roundedNetAmountHkd,
    issuedAtIso: nowIso,
    initialPayments: parsed.data.initialPayments.map((p) => ({
      tenderCode: p.tenderCode,
      amountHkd: p.amountHkd,
      paidAtIso: p.paidAtIso ?? nowIso,
      referenceNo: p.referenceNo,
    })),
  });

  return NextResponse.json({
    totals,
    promotions: promoResult,
    roundedNetAmountHkd,
    crm,
    invoice,
  });
}
