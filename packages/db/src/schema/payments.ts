import {
  mysqlTable,
  int,
  varchar,
  decimal,
  boolean,
  datetime,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { shops, terminals, staff } from "./org-auth";
import { bills } from "./sales-ar";

export const payMethods = mysqlTable(
  "pay_methods",
  {
    id: int("id").primaryKey().autoincrement(),
    legacyPm: int("legacy_pm"), // 0=Cash, 1=Octopus, 2=Visa, 3=MasterCard, 4=UnionPay, 5=Bank Transfer, 6=AE, 7=Cheque
    code: varchar("code", { length: 24 }).notNull(), // CASH | OCTOPUS | VISA | MASTERCARD | UNIONPAY | BANK_XFER | AMEX | CHEQUE
    mode: varchar("mode", { length: 32 }).notNull(), // cash | octopus | credit_card_standalone | bank_transfer | cheque | edc_card_optional
    nameZh: varchar("name_zh", { length: 80 }).notNull(),
    nameEn: varchar("name_en", { length: 80 }).notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("uq_pay_methods_code").on(t.code), uniqueIndex("uq_pay_methods_pm").on(t.legacyPm)],
);

export const billPayments = mysqlTable(
  "bill_payments",
  {
    id: int("id").primaryKey().autoincrement(),
    billId: int("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    payMethodId: int("pay_method_id")
      .notNull()
      .references(() => payMethods.id),
    legacyPk: int("legacy_pk"), // V47 HistPayment.PK for idempotent ETL upsert
    clientIdempotencyKey: varchar("client_idempotency_key", { length: 64 }),
    staffId: int("staff_id").references(() => staff.id),
    tenderCode: varchar("tender_code", { length: 24 }).notNull(),
    amount: decimal("amount", { precision: 18, scale: 4 }).notNull(),
    tipsAmount: decimal("tips_amount", { precision: 18, scale: 4 }).notNull().default("0.0000"),
    paidAt: datetime("paid_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    businessDate: varchar("business_date", { length: 10 }).notNull(),
    // Standalone Credit Card metadata (masked last4 only) or Bank Transfer / Cheque reference
    approvalCode: varchar("approval_code", { length: 16 }),
    cardLast4: varchar("card_last4", { length: 4 }),
    maskedPan: varchar("masked_pan", { length: 24 }),
    referenceNo: varchar("reference_no", { length: 64 }),
    remarks: varchar("remarks", { length: 255 }),
    voided: boolean("voided").notNull().default(false),
  },
  (t) => [
    uniqueIndex("uq_bill_pmt_idem").on(t.clientIdempotencyKey),
    uniqueIndex("uq_bill_pmt_legacy").on(t.billId, t.legacyPk),
    index("idx_bill_pmt_bill").on(t.billId),
    index("idx_bill_pmt_bdate_tender").on(t.businessDate, t.tenderCode),
  ],
);

export const octopusTransactions = mysqlTable(
  "octopus_transactions",
  {
    id: int("id").primaryKey().autoincrement(),
    billId: int("bill_id")
      .notNull()
      .references(() => bills.id),
    billPaymentId: int("bill_payment_id").references(() => billPayments.id),
    shopId: int("shop_id")
      .notNull()
      .references(() => shops.id),
    terminalId: int("terminal_id")
      .notNull()
      .references(() => terminals.id),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    cardId: varchar("card_id", { length: 32 }).notNull(),
    deviceId: varchar("device_id", { length: 32 }).notNull(),
    amountCents: int("amount_cents").notNull(),
    remainingValueCents: int("remaining_value_cents"),
    resultCode: int("result_code").notNull(),
    incomplete100022Recovered: boolean("incomplete_100022_recovered").notNull().default(false),
    transactedAt: datetime("transacted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("uq_octo_req_id").on(t.requestId), index("idx_octo_card").on(t.cardId, t.transactedAt)],
);

export const octopusSettlements = mysqlTable("octopus_settlements", {
  id: int("id").primaryKey().autoincrement(),
  shopId: int("shop_id")
    .notNull()
    .references(() => shops.id),
  terminalId: int("terminal_id")
    .notNull()
    .references(() => terminals.id),
  xfileName: varchar("xfile_name", { length: 120 }).notNull(),
  txnCount: int("txn_count").notNull(),
  totalCents: int("total_cents").notNull(),
  osdxcUploaded: boolean("osdxc_uploaded").notNull().default(false),
  settledAt: datetime("settled_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Retained for optional integrated PAX S60/A920 ECR usage (disabled by default; standalone bank terminals in active use).
 */
export const edcTransactions = mysqlTable(
  "edc_transactions",
  {
    id: int("id").primaryKey().autoincrement(),
    billId: int("bill_id")
      .notNull()
      .references(() => bills.id),
    ecrRef: varchar("ecr_ref", { length: 24 }).notNull(),
    respCode: varchar("resp_code", { length: 8 }).notNull(),
    cardType: varchar("card_type", { length: 16 }).notNull(),
    maskedPan: varchar("masked_pan", { length: 24 }).notNull(),
    approvalCode: varchar("approval_code", { length: 16 }),
    traceNo: varchar("trace_no", { length: 16 }),
    batchNo: varchar("batch_no", { length: 16 }),
    rrn: varchar("rrn", { length: 24 }),
    amount: decimal("amount", { precision: 18, scale: 4 }).notNull(),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("uq_edc_ecr_ref").on(t.ecrRef)],
);
