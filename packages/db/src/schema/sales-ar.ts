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
import { customers } from "./crm";
import { products } from "./catalog";

export const billSequences = mysqlTable(
  "bill_sequences",
  {
    id: int("id").primaryKey().autoincrement(),
    shopId: int("shop_id")
      .notNull()
      .references(() => shops.id),
    terminalId: int("terminal_id")
      .notNull()
      .references(() => terminals.id),
    docType: varchar("doc_type", { length: 24 }).notNull(), // Retail, invoice, return, payout, and OfficeX stock document types
    nextSeq: int("next_seq").notNull().default(1),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("uq_bill_seq_scope").on(t.shopId, t.terminalId, t.docType)],
);

export const bills = mysqlTable(
  "bills",
  {
    id: int("id").primaryKey().autoincrement(),
    legacyRl: varchar("legacy_rl", { length: 32 }), // V47 RL key preserved for audit/ETL idempotency
    clientIdempotencyKey: varchar("client_idempotency_key", { length: 64 }),
    shopId: int("shop_id")
      .notNull()
      .references(() => shops.id),
    terminalId: int("terminal_id")
      .notNull()
      .references(() => terminals.id),
    staffId: int("staff_id").references(() => staff.id),
    customerId: int("customer_id").references(() => customers.id),
    invoiceNo: varchar("invoice_no", { length: 40 }).notNull(),
    docType: varchar("doc_type", { length: 24 }).notNull(), // Retail, invoice, return, payout, and OfficeX stock document types
    sourceTable: varchar("source_table", { length: 16 }).notNull().default("POS_V2"), // HistHeader | OfficeXHeader | POS_V2
    legacySc: varchar("legacy_sc", { length: 32 }),
    legacyXc: int("legacy_xc").notNull().default(99),
    legacyXt: int("legacy_xt").notNull().default(1),
    legacySd: int("legacy_sd").notNull().default(-1),
    status: varchar("status", { length: 16 }).notNull().default("completed"), // open | held | intraday | completed | sealed | cancelled
    paymentStatus: varchar("payment_status", { length: 16 }).notNull().default("unpaid"), // unpaid | partial | paid | voided
    businessDate: varchar("business_date", { length: 10 }).notNull(), // YYYY-MM-DD (HKT)
    grossAmount: decimal("gross_amount", { precision: 18, scale: 4 }).notNull().default("0.0000"),
    discountAmount: decimal("discount_amount", { precision: 18, scale: 4 }).notNull().default("0.0000"),
    netAmount: decimal("net_amount", { precision: 18, scale: 4 }).notNull().default("0.0000"),
    paidAmount: decimal("paid_amount", { precision: 18, scale: 4 }).notNull().default("0.0000"),
    balanceDue: decimal("balance_due", { precision: 18, scale: 4 }).notNull().default("0.0000"),
    issuedAt: datetime("issued_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    paidAt: datetime("paid_at"),
    notes: varchar("notes", { length: 500 }),
  },
  (t) => [
    uniqueIndex("uq_bills_legacy_rl").on(t.legacyRl),
    uniqueIndex("uq_bills_invoice_no").on(t.invoiceNo),
    uniqueIndex("uq_bills_idempotency").on(t.clientIdempotencyKey),
    index("idx_bills_shop_bdate_status").on(t.shopId, t.businessDate, t.status),
    index("idx_bills_payment_ar").on(t.paymentStatus, t.balanceDue),
    index("idx_bills_customer").on(t.customerId, t.issuedAt),
  ],
);

export const billLines = mysqlTable(
  "bill_lines",
  {
    id: int("id").primaryKey().autoincrement(),
    billId: int("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    lineNo: int("line_no").notNull(),
    productId: int("product_id").references(() => products.id),
    sku: varchar("sku", { length: 40 }).notNull(),
    nameZh: varchar("name_zh", { length: 200 }).notNull(),
    nameEn: varchar("name_en", { length: 200 }).notNull().default(""),
    categoryC1: int("category_c1").notNull().default(0),
    legacyDk: int("legacy_dk").notNull().default(1),
    quantity: decimal("quantity", { precision: 18, scale: 4 }).notNull(),
    unitPrice: decimal("unit_price", { precision: 18, scale: 4 }).notNull(),
    discountRate: decimal("discount_rate", { precision: 8, scale: 6 }).notNull().default("0.000000"),
    lineDiscountAmount: decimal("line_discount_amount", { precision: 18, scale: 4 }).notNull().default("0.0000"),
    lineTotal: decimal("line_total", { precision: 18, scale: 4 }).notNull(),
    cancelled: boolean("cancelled").notNull().default(false),
    isModifier: boolean("is_modifier").notNull().default(false),
    notes: varchar("notes", { length: 300 }).notNull().default(""),
    serialNo: varchar("serial_no", { length: 80 }).notNull().default(""),
  },
  (t) => [
    uniqueIndex("uq_bill_lines_bill_lineno").on(t.billId, t.lineNo),
    index("idx_bill_lines_bill").on(t.billId, t.lineNo),
  ],
);

export const deliveryOrders = mysqlTable("delivery_orders", {
  id: int("id").primaryKey().autoincrement(),
  billId: int("bill_id")
    .notNull()
    .references(() => bills.id, { onDelete: "cascade" }),
  legacyOrl: varchar("legacy_orl", { length: 32 }),
  scheduledDate: datetime("scheduled_date"),
  deliveryStatus: varchar("delivery_status", { length: 24 }).notNull().default("pending"),
  remarks: varchar("remarks", { length: 255 }),
});

export const pettyCashVouchers = mysqlTable("petty_cash_vouchers", {
  id: int("id").primaryKey().autoincrement(),
  shopId: int("shop_id")
    .notNull()
    .references(() => shops.id),
  billId: int("bill_id").references(() => bills.id),
  amount: decimal("amount", { precision: 18, scale: 4 }).notNull(),
  reason: varchar("reason", { length: 255 }).notNull(),
  createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
