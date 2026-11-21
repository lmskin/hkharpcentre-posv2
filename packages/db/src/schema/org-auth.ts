import {
  mysqlTable,
  int,
  varchar,
  boolean,
  datetime,
  json,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const shops = mysqlTable(
  "shops",
  {
    id: int("id").primaryKey().autoincrement(),
    legacySn: int("legacy_sn").notNull(),
    code: varchar("code", { length: 16 }).notNull(),
    nameZh: varchar("name_zh", { length: 120 }).notNull(),
    nameEn: varchar("name_en", { length: 120 }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("uq_shops_legacy_sn").on(t.legacySn), uniqueIndex("uq_shops_code").on(t.code)],
);

export const terminals = mysqlTable(
  "terminals",
  {
    id: int("id").primaryKey().autoincrement(),
    shopId: int("shop_id")
      .notNull()
      .references(() => shops.id),
    legacyMn: int("legacy_mn").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    octopusEnabled: boolean("octopus_enabled").notNull().default(true),
    integratedPaxEdcEnabled: boolean("integrated_pax_edc_enabled").notNull().default(false),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("uq_terminals_shop_mn").on(t.shopId, t.legacyMn)],
);

export const staffRoles = mysqlTable(
  "staff_roles",
  {
    id: int("id").primaryKey().autoincrement(),
    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    legacyAuthorityLevel: int("legacy_authority_level").notNull().default(1),
  },
  (t) => [uniqueIndex("uq_staff_roles_code").on(t.code)],
);

export const rolePermissions = mysqlTable(
  "role_permissions",
  {
    id: int("id").primaryKey().autoincrement(),
    roleId: int("role_id")
      .notNull()
      .references(() => staffRoles.id, { onDelete: "cascade" }),
    permissionKey: varchar("permission_key", { length: 64 }).notNull(),
    allowed: boolean("allowed").notNull().default(true),
  },
  (t) => [uniqueIndex("uq_role_perm_key").on(t.roleId, t.permissionKey)],
);

export const staff = mysqlTable(
  "staff",
  {
    id: int("id").primaryKey().autoincrement(),
    legacyUs: int("legacy_us"),
    legacyId: varchar("legacy_id", { length: 32 }),
    roleId: int("role_id")
      .notNull()
      .references(() => staffRoles.id),
    shopId: int("shop_id")
      .notNull()
      .references(() => shops.id),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    pinHash: varchar("pin_hash", { length: 255 }),
    active: boolean("active").notNull().default(true),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("uq_staff_legacy_id").on(t.legacyId)],
);

export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: int("id").primaryKey().autoincrement(),
    shopId: int("shop_id").notNull(),
    staffId: int("staff_id"),
    action: varchar("action", { length: 64 }).notNull(),
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }).notNull(),
    details: json("details"),
    createdAt: datetime("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_audit_entity").on(t.entityType, t.entityId), index("idx_audit_created").on(t.createdAt)],
);
