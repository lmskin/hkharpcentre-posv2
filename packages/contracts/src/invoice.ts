import { z } from "zod";
import { RecordPaymentInputSchema } from "./payment";

export const BillStatusSchema = z.enum([
  "open",
  "held",
  "intraday",
  "completed",
  "sealed",
  "cancelled",
]);
export type BillStatus = z.infer<typeof BillStatusSchema>;

export const PaymentStatusSchema = z.enum([
  "unpaid",
  "partial",
  "paid",
  "voided",
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const BillDocTypeSchema = z.enum([
  "RETAIL_SALE",        // Legacy XC=99 (SL)
  "SALES_INVOICE",      // Formal Invoice issued upfront, settled later by Bank Transfer (replaces XC=23/22 + PM=8)
  "SALES_RETURN",       // Legacy XC=9 (RS)
  "PETTY_PAYOUT",       // Legacy XC=12 (PM)
  "GOODS_RECEIPT",      // Legacy XC=1
  "PURCHASE_RETURN",    // Legacy XC=4
  "STOCK_TRANSFER_OUT", // Legacy XC=13
  "STOCK_TRANSFER_IN",  // Legacy XC=14
  "WRITE_OFF",          // Legacy XC=10
  "STOCK_ADJUSTMENT",   // Legacy XC=15
  "STOCKTAKE",          // Legacy XC=93
  "CRM_POINT_TXN",      // Legacy XC=54
]);
export type BillDocType = z.infer<typeof BillDocTypeSchema>;

export const BillLineInputSchema = z.object({
  sku: z.string().min(1).max(40),
  nameZh: z.string().max(200),
  nameEn: z.string().max(200).default(""),
  categoryC1: z.number().int().min(0).max(999),
  quantity: z.number().positive(),
  unitPriceHkd: z.number().nonnegative(),
  discountRate: z.number().min(0).max(1).default(0), // 0.10 = 10% off (legacy DP)
  lineDiscountAmountHkd: z.number().nonnegative().default(0),
  isFixedPrice: z.boolean().default(false),
  excludeFromCrmBonus: z.boolean().default(false),
  notes: z.string().max(300).optional(),
  serialNo: z.string().max(80).optional(),
});
export type BillLineInput = z.infer<typeof BillLineInputSchema>;

/**
 * Supports both immediate POS checkout AND "Issue Invoice first -> Customer pays later by Bank Transfer".
 * When initialPayments is empty (or < netAmount), the invoice is created with paymentStatus = 'unpaid' | 'partial'
 * and a positive balanceDueHkd — without creating a $0 PM=8 dummy row.
 */
export const IssueBillOrInvoiceInputSchema = z.object({
  clientIdempotencyKey: z.string().min(8).max(64),
  shopId: z.number().int().nonnegative().default(1),
  terminalId: z.number().int().positive().optional(),
  docType: BillDocTypeSchema,
  status: z.enum(["completed", "held"]).default("completed"),
  supersedeInvoiceNo: z.string().trim().min(1).max(40).optional(),
  createDeliveryOrder: z.boolean().default(false),
  businessDateOverride: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  salespersonId: z.number().int().positive().optional(),
  customerId: z.number().int().positive().optional(),
  customerCurrentPoints: z.number().int().nonnegative().default(0),
  lines: z.array(BillLineInputSchema).min(1),
  initialPayments: z.array(RecordPaymentInputSchema).default([]),
  notes: z.string().max(500).optional(),
});
export type IssueBillOrInvoiceInput = z.infer<typeof IssueBillOrInvoiceInputSchema>;

export const SettleInvoiceInputSchema = z.object({
  invoiceNo: z.string().min(1).max(40),
  payment: RecordPaymentInputSchema,
});
export type SettleInvoiceInput = z.infer<typeof SettleInvoiceInputSchema>;
