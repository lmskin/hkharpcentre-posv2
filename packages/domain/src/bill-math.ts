import type { BillDocType, BillStatus, PaymentStatus, TenderCode } from "@hkharp/contracts";
import { toScaled4, fromScaled4, roundToCents } from "./money";

export interface DomainBillLine {
  sku?: string;
  quantity: number;
  unitPriceHkd: number;
  /** Fractional discount rate, e.g. 0.1 for 10% off (V47 DP) */
  discountRate?: number;
  /** Fixed monetary discount subtracted from the line after discountRate */
  lineDiscountAmountHkd?: number;
  /** V47 CA flag */
  cancelled?: boolean;
  /** V47 OFG modifier flag */
  isModifier?: boolean;
  /** V47 DK key (>0 normal item, -1000 CRM bonus point marker) */
  dk?: number;
}

export interface ComputedBillLine {
  grossHkd: number;
  netHkd: number;
  includedInTotals: boolean;
}

export interface BillTotals {
  lines: ComputedBillLine[];
  activeLineCount: number;
  grossAmountHkd: number;
  discountAmountHkd: number;
  netAmountHkd: number;
}

/**
 * Empirically verified across 28,285 XC=99 V47 bills (99.93% exact cent parity):
 * Active bill totals sum non-cancelled, non-modifier, dk > 0 lines (excluding dk <= -1000 CRM bonus rows).
 */
export function calculateBillTotals(lines: readonly DomainBillLine[]): BillTotals {
  let grossScaled = 0;
  let netScaled = 0;
  let activeLineCount = 0;

  const computedLines: ComputedBillLine[] = lines.map((line) => {
    const dk = line.dk ?? 1;
    const included = !line.cancelled && !line.isModifier && dk > 0;
    if (!included) {
      return { grossHkd: 0, netHkd: 0, includedInTotals: false };
    }

    activeLineCount++;
    const lineGrossHkd = line.quantity * line.unitPriceHkd;
    const rate = line.discountRate ?? 0;
    const fixedDisc = line.lineDiscountAmountHkd ?? 0;
    const lineNetHkd = lineGrossHkd * (1 - rate) - fixedDisc;

    const lineGrossScaled = toScaled4(lineGrossHkd);
    const lineNetScaled = toScaled4(lineNetHkd);

    grossScaled += lineGrossScaled;
    netScaled += lineNetScaled;

    return {
      grossHkd: roundToCents(fromScaled4(lineGrossScaled)),
      netHkd: roundToCents(fromScaled4(lineNetScaled)),
      includedInTotals: true,
    };
  });

  const grossAmountHkd = roundToCents(fromScaled4(grossScaled));
  const netAmountHkd = roundToCents(fromScaled4(netScaled));
  const discountAmountHkd = roundToCents(grossAmountHkd - netAmountHkd);

  return {
    lines: computedLines,
    activeLineCount,
    grossAmountHkd,
    discountAmountHkd,
    netAmountHkd,
  };
}

export interface AppliedPayment {
  tenderCode: TenderCode;
  amountHkd: number;
  paidAtIso: string;
  referenceNo?: string;
}

export interface InvoiceState {
  invoiceNo: string;
  docType: BillDocType;
  status: BillStatus;
  paymentStatus: PaymentStatus;
  netAmountHkd: number;
  paidAmountHkd: number;
  balanceDueHkd: number;
  issuedAtIso: string;
  paidAtIso?: string;
  payments: AppliedPayment[];
}

/**
 * First-class "Issue Invoice first -> Customer pays later by Bank Transfer" workflow.
 * Replaces legacy V47 $0 PM=8 (dlybal) dummy rows and XC=23/XC=22 adjustment pairs.
 */
export function createIssuedInvoice(params: {
  invoiceNo: string;
  docType: BillDocType;
  netAmountHkd: number;
  issuedAtIso: string;
  initialPayments?: readonly AppliedPayment[];
}): InvoiceState {
  const netScaled = toScaled4(params.netAmountHkd);
  if (netScaled < 0) {
    throw new RangeError("Invoice netAmountHkd cannot be negative");
  }

  let base: InvoiceState = {
    invoiceNo: params.invoiceNo,
    docType: params.docType,
    status: "completed",
    paymentStatus: "unpaid",
    netAmountHkd: roundToCents(fromScaled4(netScaled)),
    paidAmountHkd: 0,
    balanceDueHkd: roundToCents(fromScaled4(netScaled)),
    issuedAtIso: params.issuedAtIso,
    payments: [],
  };

  for (const pmt of params.initialPayments ?? []) {
    base = settleInvoicePayment(base, pmt);
  }
  return base;
}

export function settleInvoicePayment(invoice: InvoiceState, payment: AppliedPayment): InvoiceState {
  if (invoice.status === "cancelled" || invoice.paymentStatus === "voided") {
    throw new Error(`Cannot apply payment to voided/cancelled invoice ${invoice.invoiceNo}`);
  }
  if (payment.amountHkd <= 0) {
    throw new RangeError("Payment amountHkd must be positive");
  }

  const remainingScaled = toScaled4(invoice.balanceDueHkd);
  const pmtScaled = toScaled4(payment.amountHkd);

  if (remainingScaled <= 0) {
    throw new Error(`Invoice ${invoice.invoiceNo} is already paid in full`);
  }

  // Allow cash over-tender (change given at counter), but reject non-cash overpayment
  if (payment.tenderCode !== "CASH" && pmtScaled > remainingScaled) {
    throw new RangeError(
      `Non-cash tender ${payment.tenderCode} (${payment.amountHkd}) exceeds balance due (${invoice.balanceDueHkd})`,
    );
  }

  const appliedScaled = Math.min(pmtScaled, remainingScaled);
  const newPaidScaled = toScaled4(invoice.paidAmountHkd) + appliedScaled;
  const newBalanceScaled = Math.max(0, toScaled4(invoice.netAmountHkd) - newPaidScaled);
  const paymentStatus: PaymentStatus = newBalanceScaled === 0 ? "paid" : "partial";

  return {
    ...invoice,
    paymentStatus,
    paidAmountHkd: roundToCents(fromScaled4(newPaidScaled)),
    balanceDueHkd: roundToCents(fromScaled4(newBalanceScaled)),
    paidAtIso: paymentStatus === "paid" ? payment.paidAtIso : invoice.paidAtIso,
    payments: [...invoice.payments, { ...payment, amountHkd: roundToCents(fromScaled4(appliedScaled)) }],
  };
}
