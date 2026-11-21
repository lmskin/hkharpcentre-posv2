import type { PaymentStatus } from "@hkharp/contracts";
import { roundToCents, toScaled4, fromScaled4 } from "@hkharp/domain";

export interface LegacyInvoiceArInput {
  netAmountHkd: number;
  /** Sum of HistPayment.PA WHERE CA = 0 AND PM <> 8 */
  nonDlybalPaidHkd: number;
  cancelled: boolean;
}

export interface LegacyInvoiceArResult {
  paymentStatus: PaymentStatus;
  paidAmountHkd: number;
  balanceDueHkd: number;
}

/**
 * Converts legacy V47 bill totals + payments (excluding retired PM=8 $0 dlybal placeholders)
 * into clean Issue-Invoice -> Settle-Later AR status.
 */
export function classifyLegacyInvoiceArState(input: LegacyInvoiceArInput): LegacyInvoiceArResult {
  if (input.cancelled) {
    return {
      paymentStatus: "voided",
      paidAmountHkd: 0,
      balanceDueHkd: 0,
    };
  }

  const netScaled = toScaled4(Math.max(0, input.netAmountHkd));
  const paidScaled = toScaled4(Math.max(0, input.nonDlybalPaidHkd));
  const cappedPaidScaled = Math.min(netScaled, paidScaled);
  const balanceScaled = Math.max(0, netScaled - cappedPaidScaled);

  let paymentStatus: PaymentStatus = "paid";
  if (netScaled > 0 && cappedPaidScaled === 0) {
    paymentStatus = "unpaid";
  } else if (balanceScaled > 500) {
    // Allow <= $0.05 legacy rounding tolerance as paid in full
    paymentStatus = "partial";
  }

  return {
    paymentStatus,
    paidAmountHkd: roundToCents(fromScaled4(cappedPaidScaled)),
    balanceDueHkd: paymentStatus === "paid" ? 0 : roundToCents(fromScaled4(balanceScaled)),
  };
}
