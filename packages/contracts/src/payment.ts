import { z } from "zod";

/**
 * Authoritative V47 -> MySQL 8 Payment Method codes & execution modes.
 * Note: Legacy PM=3 is confirmed MasterCard (overriding legacy D1L='支付寶' mislabel).
 * Legacy PM=8 ($0 dlybal) is retired in favor of bills.payment_status = 'unpaid' | 'partial'.
 */
export const PaymentModeSchema = z.enum([
  "cash",
  "octopus",
  "credit_card_standalone",
  "bank_transfer",
  "cheque",
  "edc_card_optional",
]);
export type PaymentMode = z.infer<typeof PaymentModeSchema>;

export const TenderCodeSchema = z.enum([
  "CASH",        // Legacy PM=0
  "OCTOPUS",     // Legacy PM=1 (PC-connected RWL reader via pos-hardware-bridge)
  "VISA",        // Legacy PM=2 (Standalone bank card terminal)
  "MASTERCARD",  // Legacy PM=3 (Confirmed MasterCard; standalone bank card terminal)
  "UNIONPAY",    // Legacy PM=4 (Standalone bank card terminal)
  "BANK_XFER",   // Legacy PM=5 (Bank transfer settlement for issued invoices / orders)
  "AMEX",        // Legacy PM=6 (Standalone bank card terminal)
  "CHEQUE",      // Legacy PM=7 (Cheque settlement)
]);
export type TenderCode = z.infer<typeof TenderCodeSchema>;

export const MaskedPanSchema = z
  .string()
  .regex(/^\*{8,15}\d{4}$/, "Only masked PAN ending in 4 digits (e.g. ************1234) may be stored");

export const CardLast4Schema = z
  .string()
  .regex(/^\d{4}$/, "Card last-4 must be exactly 4 digits");

export const RecordPaymentInputSchema = z
  .object({
    clientIdempotencyKey: z.string().min(8).max(64),
    tenderCode: TenderCodeSchema,
    amountHkd: z.number().positive(),
    paidAtIso: z.string().datetime().optional(),
    // Standalone credit card metadata (never raw track/CVV/full PAN)
    approvalCode: z.string().trim().max(16).optional(),
    cardLast4: CardLast4Schema.optional(),
    // Bank transfer / Cheque reference
    referenceNo: z.string().trim().max(64).optional(),
    remarks: z.string().trim().max(255).optional(),
    // Octopus RWL metadata (when tenderCode === 'OCTOPUS')
    octopusCardId: z.string().trim().max(32).optional(),
    octopusDeviceId: z.string().trim().max(32).optional(),
    octopusRemainingHkd: z.number().nonnegative().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.tenderCode === "OCTOPUS") {
      const cents = Math.round(val.amountHkd * 100);
      if (cents % 10 !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["amountHkd"],
          message: "Octopus deduction must be a multiple of HK$0.10 (10 cents)",
        });
      }
      if (val.amountHkd > 3000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["amountHkd"],
          message: "Octopus deduction exceeds HK$3,000 maximum limit",
        });
      }
    }
  });

export type RecordPaymentInput = z.infer<typeof RecordPaymentInputSchema>;
