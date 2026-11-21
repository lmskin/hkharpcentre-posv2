import {
  mysqlTable,
  int,
  varchar,
  decimal,
  boolean,
  datetime,
  json,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { shops, terminals, staff } from "./org-auth";
import { products } from "./catalog";

export const stockBalances = mysqlTable(
  "stock_balances",
  {
    id: int("id").primaryKey().autoincrement(),
    shopId: int("shop_id")
      .notNull()
      .references(() => shops.id),
    productId: int("product_id")
      .notNull()
      .references(() => products.id),
    onHandQty: decimal("on_hand_qty", { precision: 18, scale: 4 }).notNull().default("0.0000"),
    movingAvgCost: decimal("moving_avg_cost", { precision: 18, scale: 4 }).notNull().default("0.0000"),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("uq_stock_shop_product").on(t.shopId, t.productId)],
);

export const stockMovements = mysqlTable(
  "stock_movements",
  {
    id: int("id").primaryKey().autoincrement(),
    shopId: int("shop_id")
      .notNull()
      .references(() => shops.id),
    productId: int("product_id")
      .notNull()
      .references(() => products.id),
    billId: int("bill_id"),
    movementType: varchar("movement_type", { length: 24 }).notNull(), // SALE | RETURN | PURCHASE_IN | ADJUST | WRITE_OFF | STOCKTAKE
    legacyXc: int("legacy_xc"),
    onHandDelta: decimal("on_hand_delta", { precision: 18, scale: 4 }).notNull(),
    unitCost: decimal("unit_cost", { precision: 18, scale: 4 }).notNull(),
    movingAvgCostAfter: decimal("moving_avg_cost_after", { precision: 18, scale: 4 }).notNull(),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_stock_mov_prod_time").on(t.shopId, t.productId, t.createdAt)],
);

export const stockTakes = mysqlTable("stock_takes", {
  id: int("id").primaryKey().autoincrement(),
  shopId: int("shop_id")
    .notNull()
    .references(() => shops.id),
  staffId: int("staff_id").references(() => staff.id),
  status: varchar("status", { length: 16 }).notNull().default("open"),
  snapshotDate: datetime("snapshot_date").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const stockTakeLines = mysqlTable("stock_take_lines", {
  id: int("id").primaryKey().autoincrement(),
  stockTakeId: int("stock_take_id")
    .notNull()
    .references(() => stockTakes.id, { onDelete: "cascade" }),
  productId: int("product_id")
    .notNull()
    .references(() => products.id),
  expectedQty: decimal("expected_qty", { precision: 18, scale: 4 }).notNull(),
  countedQty: decimal("counted_qty", { precision: 18, scale: 4 }).notNull(),
});

export const dayEndBatches = mysqlTable(
  "day_end_batches",
  {
    id: int("id").primaryKey().autoincrement(),
    legacyBk: varchar("legacy_bk", { length: 32 }),
    shopId: int("shop_id")
      .notNull()
      .references(() => shops.id),
    terminalId: int("terminal_id")
      .notNull()
      .references(() => terminals.id),
    businessDate: varchar("business_date", { length: 10 }).notNull(),
    batchNo: int("batch_no").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("open"), // open | first_count | closed
    issuedSalesTotal: decimal("issued_sales_total", { precision: 18, scale: 4 }).notNull().default("0.0000"),
    collectedPaymentsTotal: decimal("collected_payments_total", { precision: 18, scale: 4 }).notNull().default("0.0000"),
    closed: boolean("closed").notNull().default(false),
    closedAt: datetime("closed_at"),
  },
  (t) => [
    uniqueIndex("uq_day_end_scope").on(t.shopId, t.terminalId, t.businessDate, t.batchNo),
    uniqueIndex("uq_day_end_legacy_bk").on(t.legacyBk),
  ],
);

export const dayEndTenderCounts = mysqlTable("day_end_tender_counts", {
  id: int("id").primaryKey().autoincrement(),
  batchId: int("batch_id")
    .notNull()
    .references(() => dayEndBatches.id, { onDelete: "cascade" }),
  tenderCode: varchar("tender_code", { length: 24 }).notNull(),
  expectedCollectedAmount: decimal("expected_collected_amount", { precision: 18, scale: 4 }).notNull(),
  countedAmount: decimal("counted_amount", { precision: 18, scale: 4 }).notNull(),
  varianceAmount: decimal("variance_amount", { precision: 18, scale: 4 }).notNull(),
});

export const dailyHourlySales = mysqlTable(
  "daily_hourly_sales",
  {
    id: int("id").primaryKey().autoincrement(),
    shopId: int("shop_id")
      .notNull()
      .references(() => shops.id),
    businessDate: varchar("business_date", { length: 10 }).notNull(),
    hourOfDay: int("hour_of_day").notNull(),
    billCount: int("bill_count").notNull().default(0),
    netSalesAmount: decimal("net_sales_amount", { precision: 18, scale: 4 }).notNull().default("0.0000"),
  },
  (t) => [uniqueIndex("uq_dhsales_hour").on(t.shopId, t.businessDate, t.hourOfDay)],
);

export const appSettings = mysqlTable(
  "app_settings",
  {
    id: int("id").primaryKey().autoincrement(),
    shopId: int("shop_id").notNull().default(0),
    settingKey: varchar("setting_key", { length: 64 }).notNull(),
    settingValue: json("setting_value").notNull(),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("uq_app_settings_key").on(t.shopId, t.settingKey)],
);
