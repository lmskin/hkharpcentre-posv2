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
import { shops } from "./org-auth";

export const categories = mysqlTable(
  "categories",
  {
    id: int("id").primaryKey().autoincrement(),
    legacyC1: int("legacy_c1").notNull(),
    nameZh: varchar("name_zh", { length: 120 }).notNull(),
    nameEn: varchar("name_en", { length: 120 }).notNull(),
    sortOrder: int("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("uq_categories_c1").on(t.legacyC1)],
);

export const units = mysqlTable(
  "units",
  {
    id: int("id").primaryKey().autoincrement(),
    legacyUn: int("legacy_un").notNull(),
    nameZh: varchar("name_zh", { length: 40 }).notNull(),
    nameEn: varchar("name_en", { length: 40 }).notNull(),
  },
  (t) => [uniqueIndex("uq_units_un").on(t.legacyUn)],
);

export const products = mysqlTable(
  "products",
  {
    id: int("id").primaryKey().autoincrement(),
    shopId: int("shop_id")
      .notNull()
      .references(() => shops.id),
    barcode: varchar("barcode", { length: 40 }).notNull(), // V47 ProductOnSale.BC
    ubc: varchar("ubc", { length: 40 }).notNull().default(""),
    nameZh: varchar("name_zh", { length: 200 }).notNull(),
    nameEn: varchar("name_en", { length: 200 }).notNull().default(""),
    categoryId: int("category_id").references(() => categories.id),
    legacyC1: int("legacy_c1").notNull().default(0),
    unitId: int("unit_id").references(() => units.id),
    sellPrice: decimal("sell_price", { precision: 18, scale: 4 }).notNull().default("0.0000"),
    fixedPrice: decimal("fixed_price", { precision: 18, scale: 4 }),
    lastPurchaseCost: decimal("last_purchase_cost", { precision: 18, scale: 4 }).notNull().default("0.0000"),
    avgCost: decimal("avg_cost", { precision: 18, scale: 4 }).notNull().default("0.0000"),
    allowItemDiscount: boolean("allow_item_discount").notNull().default(true),
    excludeFromCrmBonus: boolean("exclude_from_crm_bonus").notNull().default(false),
    active: boolean("active").notNull().default(true),
    updatedAt: datetime("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("uq_products_shop_barcode").on(t.shopId, t.barcode),
    index("idx_products_ubc").on(t.ubc),
    index("idx_products_c1").on(t.legacyC1),
  ],
);

export const posMenus = mysqlTable(
  "pos_menus",
  {
    id: int("id").primaryKey().autoincrement(),
    shopId: int("shop_id")
      .notNull()
      .references(() => shops.id),
    code: varchar("code", { length: 32 }).notNull(),
    titleZh: varchar("title_zh", { length: 120 }).notNull(),
    titleEn: varchar("title_en", { length: 120 }).notNull(),
    sortOrder: int("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("uq_pos_menus_shop_code").on(t.shopId, t.code)],
);

export const posMenuButtons = mysqlTable(
  "pos_menu_buttons",
  {
    id: int("id").primaryKey().autoincrement(),
    menuId: int("menu_id")
      .notNull()
      .references(() => posMenus.id, { onDelete: "cascade" }),
    productId: int("product_id").references(() => products.id),
    labelZh: varchar("label_zh", { length: 80 }).notNull(),
    labelEn: varchar("label_en", { length: 80 }).notNull(),
    gridPosition: int("grid_position").notNull().default(0),
    colorHex: varchar("color_hex", { length: 16 }),
  },
  (t) => [uniqueIndex("uq_menu_btn_pos").on(t.menuId, t.gridPosition)],
);

export const labelTemplates = mysqlTable("label_templates", {
  id: int("id").primaryKey().autoincrement(),
  name: varchar("name", { length: 80 }).notNull(),
  widthMm: int("width_mm").notNull(),
  heightMm: int("height_mm").notNull(),
  definition: json("definition").notNull(),
});
