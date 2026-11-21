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

export const customerGrades = mysqlTable(
  "customer_grades",
  {
    id: int("id").primaryKey().autoincrement(),
    legacyCode: int("legacy_code").notNull(),
    nameZh: varchar("name_zh", { length: 80 }).notNull(),
    nameEn: varchar("name_en", { length: 80 }).notNull(),
    defaultDiscountRate: decimal("default_discount_rate", { precision: 6, scale: 4 }).notNull().default("0.0000"),
  },
  (t) => [uniqueIndex("uq_customer_grades_code").on(t.legacyCode)],
);

export const customers = mysqlTable(
  "customers",
  {
    id: int("id").primaryKey().autoincrement(),
    legacyId: varchar("legacy_id", { length: 32 }).notNull(), // StaffCounterparty TP='2'.ID
    gradeId: int("grade_id").references(() => customerGrades.id),
    nameZh: varchar("name_zh", { length: 160 }).notNull(),
    nameEn: varchar("name_en", { length: 160 }).notNull().default(""),
    phone: varchar("phone", { length: 40 }).notNull().default(""),
    email: varchar("email", { length: 160 }).notNull().default(""),
    pointsBalance: int("points_balance").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("uq_customers_legacy_id").on(t.legacyId),
    index("idx_customers_phone").on(t.phone),
  ],
);

export const memberCards = mysqlTable(
  "member_cards",
  {
    id: int("id").primaryKey().autoincrement(),
    customerId: int("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    cardNo: varchar("card_no", { length: 40 }).notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("uq_member_cards_no").on(t.cardNo)],
);

export const crmRules = mysqlTable(
  "crm_rules",
  {
    id: int("id").primaryKey().autoincrement(),
    legacyRid: int("legacy_rid").notNull(),
    ruleName: varchar("rule_name", { length: 120 }).notNull(),
    descriptionEn: varchar("description_en", { length: 255 }).notNull(),
    actionType: int("action_type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    priority: int("priority").notNull().default(0),
  },
  (t) => [uniqueIndex("uq_crm_rules_rid").on(t.legacyRid)],
);

export const crmPointLedger = mysqlTable(
  "crm_point_ledger",
  {
    id: int("id").primaryKey().autoincrement(),
    customerId: int("customer_id")
      .notNull()
      .references(() => customers.id),
    billId: int("bill_id"),
    ruleRid: int("rule_rid"),
    deltaPoints: int("delta_points").notNull(),
    reason: varchar("reason", { length: 120 }).notNull(),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_crm_ledger_cust").on(t.customerId, t.createdAt)],
);

export const suppliers = mysqlTable(
  "suppliers",
  {
    id: int("id").primaryKey().autoincrement(),
    legacyId: varchar("legacy_id", { length: 32 }).notNull(),
    nameZh: varchar("name_zh", { length: 160 }).notNull(),
    nameEn: varchar("name_en", { length: 160 }).notNull().default(""),
    phone: varchar("phone", { length: 40 }).notNull().default(""),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("uq_suppliers_legacy_id").on(t.legacyId)],
);
