import { and, desc, eq, inArray, like, ne, or, sql } from "drizzle-orm";
import type mysql from "mysql2/promise";
import { createDb, type HarpDb } from "./client";
import { verifySecret } from "./auth";
import { auditLogs, shops, staff, staffRoles, terminals } from "./schema/org-auth";
import { categories, posMenuButtons, posMenus, products, units } from "./schema/catalog";
import { crmPointLedger, customerGrades, customers, memberCards, suppliers } from "./schema/crm";
import { billLines, bills, deliveryOrders } from "./schema/sales-ar";
import { billPayments } from "./schema/payments";
import { appSettings, dayEndBatches, stockBalances, stockMovements } from "./schema/stock-ops";
import { formatHktBusinessDate } from "./transactions";

const SALES_DOC_TYPES = ["RETAIL_SALE", "SALES_INVOICE", "SALES_RETURN"] as const;

export interface ActiveStoreContext {
  shopId: number;
  legacySn: number;
  shopCode: string;
  shopNameZh: string;
  shopNameEn: string;
  terminalId: number;
  legacyMn: number;
  terminalName: string;
}

let sharedConn: { db: HarpDb; pool: mysql.Pool; url: string } | null = null;

function isConfiguredUrl(raw: string | undefined): raw is string {
  if (!raw || raw.trim() === "") return false;
  return (
    !raw.includes("REPLACE_WITH_YOUR_MYSQL_PASSWORD") &&
    !raw.includes("change_me_in_prod") &&
    !raw.includes("change_me")
  );
}

export function getSharedDb(): { db: HarpDb; pool: mysql.Pool } | null {
  const url = process.env.DATABASE_URL;
  if (!isConfiguredUrl(url)) return null;
  if (!sharedConn || sharedConn.url !== url) {
    sharedConn = { ...createDb(url), url };
  }
  return sharedConn;
}

export function requireSharedDb(): { db: HarpDb; pool: mysql.Pool } {
  const conn = getSharedDb();
  if (!conn) {
    throw new Error("MySQL DATABASE_URL is not configured");
  }
  return conn;
}

export interface MySqlHealthStatus {
  configured: boolean;
  connected: boolean;
  mysqlVersion?: string;
  tableCount?: number;
  productCount?: number;
  billCount?: number;
  errorCode?: string;
}

export async function pingMySqlHealth(): Promise<MySqlHealthStatus> {
  const conn = getSharedDb();
  if (!conn) {
    return { configured: false, connected: false };
  }

  try {
    const [verRows] = await conn.pool.query("SELECT VERSION() AS ver");
    const mysqlVersion =
      Array.isArray(verRows) && verRows[0] && "ver" in verRows[0]
        ? String((verRows[0] as { ver: string }).ver)
        : undefined;

    const [tblRows] = await conn.pool.query("SHOW TABLES");
    const tableCount = Array.isArray(tblRows) ? tblRows.length : 0;

    let productCount = 0;
    let billCount = 0;
    if (tableCount > 0) {
      const [pRes, bRes] = await Promise.all([
        conn.db.select({ cnt: sql<number>`COUNT(*)` }).from(products),
        conn.db.select({ cnt: sql<number>`COUNT(*)` }).from(bills),
      ]);
      productCount = Number(pRes[0]?.cnt ?? 0);
      billCount = Number(bRes[0]?.cnt ?? 0);
    }

    return {
      configured: true,
      connected: true,
      mysqlVersion,
      tableCount,
      productCount,
      billCount,
    };
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: unknown }).code)
        : "CONNECT_ERROR";
    return { configured: true, connected: false, errorCode: code };
  }
}

export async function resolveActiveStoreContext(
  preferredShopSn?: number,
  preferredTerminalMn?: number,
): Promise<ActiveStoreContext> {
  const conn = requireSharedDb();
  const targetSn = preferredShopSn ?? Number(process.env.SHOP_ID ?? "1");
  const targetMn = preferredTerminalMn ?? Number(process.env.TERMINAL_ID ?? "1");

  const shopRows = await conn.db.select().from(shops).where(eq(shops.active, true)).orderBy(shops.legacySn, shops.id);
  const activeShop =
    shopRows.find((s) => s.legacySn === targetSn) ??
    shopRows.find((s) => s.legacySn > 0) ??
    shopRows[0];

  if (!activeShop) {
    return {
      shopId: 1,
      legacySn: 1,
      shopCode: "CENTRAL",
      shopNameZh: "中環門市",
      shopNameEn: "Central",
      terminalId: 1,
      legacyMn: 1,
      terminalName: "Counter 1-1",
    };
  }

  const termRows = await conn.db
    .select()
    .from(terminals)
    .where(eq(terminals.shopId, activeShop.id))
    .orderBy(terminals.legacyMn, terminals.id);
  const activeTerminal =
    termRows.find((t) => t.legacyMn === targetMn && t.active) ??
    termRows.find((t) => t.active) ??
    termRows[0];

  return {
    shopId: activeShop.id,
    legacySn: activeShop.legacySn,
    shopCode: activeShop.code,
    shopNameZh: activeShop.nameZh,
    shopNameEn: activeShop.nameEn,
    terminalId: activeTerminal?.id ?? 1,
    legacyMn: activeTerminal?.legacyMn ?? 1,
    terminalName: activeTerminal?.name ?? `Counter ${activeShop.legacySn}-${targetMn}`,
  };
}

export async function authenticateStaff(params: {
  staffCode?: string;
  password?: string;
  pin?: string;
}) {
  const conn = requireSharedDb();
  const rows = await conn.db
    .select({
      id: staff.id,
      legacyId: staff.legacyId,
      displayName: staff.displayName,
      shopId: staff.shopId,
      passwordHash: staff.passwordHash,
      pinHash: staff.pinHash,
      active: staff.active,
      roleLevel: staffRoles.legacyAuthorityLevel,
    })
    .from(staff)
    .innerJoin(staffRoles, eq(staff.roleId, staffRoles.id))
    .where(params.staffCode ? eq(staff.legacyId, params.staffCode) : eq(staff.active, true));

  for (const r of rows) {
    if (!r.active) continue;
    const pinMatch = params.pin ? verifySecret(params.pin, r.pinHash) : false;
    const pwMatch = params.password && params.staffCode ? verifySecret(params.password, r.passwordHash) : false;
    if (pinMatch || pwMatch) {
      const [staffShop] = await conn.db
        .select({ legacySn: shops.legacySn })
        .from(shops)
        .where(eq(shops.id, r.shopId))
        .limit(1);
      const storeCtx = await resolveActiveStoreContext();
      const resolvedShopId = staffShop?.legacySn === 0 ? storeCtx.shopId : r.shopId;
      return {
        staffId: r.id,
        legacyId: r.legacyId ?? String(r.id),
        displayName: r.displayName,
        roleLevel: r.roleLevel,
        shopId: resolvedShopId,
      };
    }
  }
  return null;
}

export async function authorizeManagerOverride(managerPin: string, minRoleLevel = 4) {
  const clean = managerPin.trim();
  if (!clean) return null;
  const user = await authenticateStaff({ pin: clean });
  if (!user || user.roleLevel < minRoleLevel) return null;
  return user;
}

export async function recordLoginAudit(input: {
  staffId?: number;
  shopId?: number;
  staffCode?: string;
  mode: "pin" | "password";
  success: boolean;
}) {
  const conn = getSharedDb();
  if (!conn) return;
  await conn.db.insert(auditLogs).values({
    shopId: input.shopId ?? 0,
    staffId: input.staffId ?? null,
    action: input.success ? "LOGIN_SUCCESS" : "LOGIN_FAILED",
    entityType: "staff",
    entityId: input.staffCode ?? input.staffId?.toString() ?? "PIN",
    details: { mode: input.mode },
  });
}

export async function getDashboardSummary() {
  const conn = getSharedDb();
  if (!conn) return null;
  const today = formatHktBusinessDate();
  const storeCtx = await resolveActiveStoreContext();

  const [countsRow] = await conn.db
    .select({
      productCount: sql<number>`(SELECT COUNT(*) FROM products)`,
      customerCount: sql<number>`(SELECT COUNT(*) FROM customers)`,
      billCount: sql<number>`(SELECT COUNT(*) FROM bills)`,
      openArCount: sql<number>`(SELECT COUNT(*) FROM bills WHERE payment_status IN ('unpaid','partial') AND balance_due > 0 AND status <> 'cancelled')`,
      openArTotal: sql<string>`(SELECT COALESCE(SUM(balance_due), 0) FROM bills WHERE payment_status IN ('unpaid','partial') AND balance_due > 0 AND status <> 'cancelled')`,
      todayIssuedSales: sql<string>`(SELECT COALESCE(SUM(CASE WHEN doc_type = 'SALES_RETURN' THEN -net_amount ELSE net_amount END), 0) FROM bills WHERE shop_id = ${storeCtx.shopId} AND business_date = ${today} AND status <> 'cancelled' AND doc_type IN ('RETAIL_SALE','SALES_INVOICE','SALES_RETURN'))`,
      todayCollectedPayments: sql<string>`(SELECT COALESCE(SUM(CASE WHEN b.doc_type IN ('SALES_RETURN','PETTY_PAYOUT') THEN -bp.amount ELSE bp.amount END), 0) FROM bill_payments bp JOIN bills b ON b.id = bp.bill_id WHERE b.shop_id = ${storeCtx.shopId} AND bp.business_date = ${today} AND bp.voided = 0 AND b.status <> 'cancelled')`,
    })
    .from(shops)
    .limit(1);

  return {
    todayBusinessDate: today,
    productCount: Number(countsRow?.productCount ?? 0),
    customerCount: Number(countsRow?.customerCount ?? 0),
    billCount: Number(countsRow?.billCount ?? 0),
    openArCount: Number(countsRow?.openArCount ?? 0),
    openArTotalHkd: Number(countsRow?.openArTotal ?? 0),
    todayIssuedSalesHkd: Number(countsRow?.todayIssuedSales ?? 0),
    todayCollectedPaymentsHkd: Number(countsRow?.todayCollectedPayments ?? 0),
  };
}

export async function listCatalogProducts(limit = 60) {
  const conn = getSharedDb();
  if (!conn) return null;

  const rows = await conn.db
    .select({
      id: products.id,
      sku: products.barcode,
      ubc: products.ubc,
      nameZh: products.nameZh,
      nameEn: products.nameEn,
      categoryC1: products.legacyC1,
      categoryNameEn: categories.nameEn,
      sellPrice: products.sellPrice,
      fixedPrice: products.fixedPrice,
      avgCost: products.avgCost,
      allowItemDiscount: products.allowItemDiscount,
      excludeFromCrmBonus: products.excludeFromCrmBonus,
      active: products.active,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(products.active, true))
    .orderBy(products.barcode)
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    ubc: r.ubc,
    nameZh: r.nameZh,
    nameEn: r.nameEn || r.nameZh,
    categoryLabel: `${r.categoryNameEn ?? "General"} (C1=${r.categoryC1})`,
    categoryC1: r.categoryC1,
    unitPriceHkd: Number(r.sellPrice),
    fixedPriceHkd: r.fixedPrice !== null ? Number(r.fixedPrice) : null,
    avgCostHkd: Number(r.avgCost),
    allowItemDiscount: r.allowItemDiscount,
    isFixedPrice: r.fixedPrice !== null,
    excludeFromCrmBonus: r.excludeFromCrmBonus,
    active: r.active,
  }));
}

export async function searchProducts(params: { q?: string; categoryC1?: number; limit?: number; offset?: number }) {
  const conn = requireSharedDb();
  const q = params.q?.trim();
  const limit = Math.min(params.limit ?? 60, 200);
  const offset = Math.max(0, params.offset ?? 0);

  const filters = [];
  if (q) {
    const pattern = `%${q}%`;
    filters.push(
      or(
        like(products.barcode, pattern),
        like(products.ubc, pattern),
        like(products.nameEn, pattern),
        like(products.nameZh, pattern),
      ),
    );
  }
  if (params.categoryC1 !== undefined && Number.isFinite(params.categoryC1)) {
    filters.push(eq(products.legacyC1, params.categoryC1));
  }

  const rows = await conn.db
    .select({
      id: products.id,
      sku: products.barcode,
      ubc: products.ubc,
      nameZh: products.nameZh,
      nameEn: products.nameEn,
      categoryC1: products.legacyC1,
      categoryNameEn: categories.nameEn,
      sellPrice: products.sellPrice,
      fixedPrice: products.fixedPrice,
      avgCost: products.avgCost,
      allowItemDiscount: products.allowItemDiscount,
      excludeFromCrmBonus: products.excludeFromCrmBonus,
      active: products.active,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(products.barcode)
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    ubc: r.ubc,
    nameZh: r.nameZh,
    nameEn: r.nameEn || r.nameZh,
    categoryLabel: `${r.categoryNameEn ?? "General"} (C1=${r.categoryC1})`,
    categoryC1: r.categoryC1,
    unitPriceHkd: Number(r.sellPrice),
    fixedPriceHkd: r.fixedPrice !== null ? Number(r.fixedPrice) : null,
    avgCostHkd: Number(r.avgCost),
    allowItemDiscount: r.allowItemDiscount,
    isFixedPrice: r.fixedPrice !== null,
    excludeFromCrmBonus: r.excludeFromCrmBonus,
    active: r.active,
  }));
}

export async function countProducts(params: { q?: string; categoryC1?: number }) {
  const conn = requireSharedDb();
  const q = params.q?.trim();
  const filters = [];
  if (q) {
    const pattern = `%${q}%`;
    filters.push(
      or(
        like(products.barcode, pattern),
        like(products.ubc, pattern),
        like(products.nameEn, pattern),
        like(products.nameZh, pattern),
      ),
    );
  }
  if (params.categoryC1 !== undefined && Number.isFinite(params.categoryC1)) {
    filters.push(eq(products.legacyC1, params.categoryC1));
  }
  const [row] = await conn.db
    .select({ total: sql<number>`COUNT(*)` })
    .from(products)
    .where(filters.length > 0 ? and(...filters) : undefined);
  return Number(row?.total ?? 0);
}

export async function findExactProductByCode(code: string) {
  const clean = code.trim();
  if (!clean) return null;
  const conn = requireSharedDb();
  const selectFields = {
    id: products.id,
    sku: products.barcode,
    ubc: products.ubc,
    nameZh: products.nameZh,
    nameEn: products.nameEn,
    categoryC1: products.legacyC1,
    sellPrice: products.sellPrice,
    fixedPrice: products.fixedPrice,
    avgCost: products.avgCost,
    allowItemDiscount: products.allowItemDiscount,
    excludeFromCrmBonus: products.excludeFromCrmBonus,
  };
  let rows = await conn.db.select(selectFields).from(products).where(eq(products.barcode, clean)).limit(1);
  if (rows.length === 0) {
    rows = await conn.db.select(selectFields).from(products).where(eq(products.ubc, clean)).limit(1);
  }
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    sku: r.sku,
    ubc: r.ubc,
    nameZh: r.nameZh,
    nameEn: r.nameEn || r.nameZh,
    categoryC1: r.categoryC1,
    unitPriceHkd: Number(r.sellPrice),
    fixedPriceHkd: r.fixedPrice !== null ? Number(r.fixedPrice) : null,
    avgCostHkd: Number(r.avgCost),
    allowItemDiscount: r.allowItemDiscount,
    isFixedPrice: r.fixedPrice !== null,
    excludeFromCrmBonus: r.excludeFromCrmBonus,
  };
}

export async function listCategoriesAndUnits() {
  const conn = requireSharedDb();
  const [cats, unitList] = await Promise.all([
    conn.db.select().from(categories).orderBy(categories.legacyC1),
    conn.db.select().from(units).orderBy(units.legacyUn),
  ]);
  return { categories: cats, units: unitList };
}

export async function upsertProductRecord(input: {
  barcode: string;
  ubc?: string;
  nameZh: string;
  nameEn: string;
  legacyC1: number;
  sellPriceHkd: number;
  fixedPriceHkd?: number | null;
  allowItemDiscount?: boolean;
  excludeFromCrmBonus?: boolean;
}) {
  const conn = requireSharedDb();
  const [cat] = await conn.db.select().from(categories).where(eq(categories.legacyC1, input.legacyC1)).limit(1);
  const [shopRow] = await conn.db.select().from(shops).where(eq(shops.legacySn, 0)).limit(1);
  const shopId = shopRow?.id ?? 1;

  const existing = await conn.db.select().from(products).where(eq(products.barcode, input.barcode)).limit(1);
  if (existing.length > 0) {
    await conn.db
      .update(products)
      .set({
        ubc: input.ubc !== undefined ? input.ubc : existing[0]!.ubc,
        nameZh: input.nameZh,
        nameEn: input.nameEn,
        legacyC1: input.legacyC1,
        categoryId: cat?.id ?? existing[0]!.categoryId,
        sellPrice: input.sellPriceHkd.toFixed(4),
        fixedPrice:
          input.fixedPriceHkd !== undefined
            ? input.fixedPriceHkd !== null
              ? input.fixedPriceHkd.toFixed(4)
              : null
            : existing[0]!.fixedPrice,
        allowItemDiscount: input.allowItemDiscount ?? existing[0]!.allowItemDiscount,
        excludeFromCrmBonus: input.excludeFromCrmBonus ?? existing[0]!.excludeFromCrmBonus,
        updatedAt: new Date(),
      })
      .where(eq(products.id, existing[0]!.id));
    return { ok: true, id: existing[0]!.id, created: false };
  }

  const res = await conn.db.insert(products).values({
    shopId,
    barcode: input.barcode,
    ubc: input.ubc ?? "",
    nameZh: input.nameZh,
    nameEn: input.nameEn,
    legacyC1: input.legacyC1,
    categoryId: cat?.id ?? null,
    sellPrice: input.sellPriceHkd.toFixed(4),
    fixedPrice:
      input.fixedPriceHkd !== undefined && input.fixedPriceHkd !== null ? input.fixedPriceHkd.toFixed(4) : null,
    allowItemDiscount: input.allowItemDiscount ?? true,
    excludeFromCrmBonus: input.excludeFromCrmBonus ?? false,
    active: true,
  });
  return { ok: true, id: Number(res[0].insertId), created: true };
}

export async function listPosMenusWithButtons() {
  const conn = getSharedDb();
  if (!conn) return [];

  const menus = await conn.db.select().from(posMenus).orderBy(posMenus.sortOrder);
  if (menus.length === 0) return [];

  const buttons = await conn.db
    .select({
      menuId: posMenuButtons.menuId,
      labelZh: posMenuButtons.labelZh,
      labelEn: posMenuButtons.labelEn,
      gridPosition: posMenuButtons.gridPosition,
      sku: products.barcode,
      ubc: products.ubc,
      nameZh: products.nameZh,
      nameEn: products.nameEn,
      categoryC1: products.legacyC1,
      sellPrice: products.sellPrice,
      fixedPrice: products.fixedPrice,
      allowItemDiscount: products.allowItemDiscount,
      excludeFromCrmBonus: products.excludeFromCrmBonus,
    })
    .from(posMenuButtons)
    .leftJoin(products, eq(posMenuButtons.productId, products.id))
    .orderBy(posMenuButtons.menuId, posMenuButtons.gridPosition);

  const byMenu = new Map<number, typeof buttons>();
  for (const b of buttons) {
    const arr = byMenu.get(b.menuId) ?? [];
    arr.push(b);
    byMenu.set(b.menuId, arr);
  }

  return menus.map((m) => ({
    id: m.id,
    code: m.code,
    titleZh: m.titleZh,
    titleEn: m.titleEn,
    buttons: (byMenu.get(m.id) ?? [])
      .filter((b) => b.sku !== null)
      .map((b) => ({
        sku: b.sku!,
        ubc: b.ubc ?? "",
        nameZh: b.nameZh ?? b.labelZh,
        nameEn: b.nameEn || b.labelEn,
        categoryC1: b.categoryC1 ?? 0,
        unitPriceHkd: Number(b.sellPrice ?? 0),
        allowItemDiscount: b.allowItemDiscount ?? true,
        isFixedPrice: b.fixedPrice !== null,
        excludeFromCrmBonus: b.excludeFromCrmBonus ?? false,
      })),
  }));
}

export async function searchCustomers(params: { q?: string; limit?: number; offset?: number }) {
  const conn = requireSharedDb();
  const q = params.q?.trim();
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = Math.max(0, params.offset ?? 0);
  const pattern = q ? `%${q}%` : undefined;

  const rows = await conn.db
    .select({
      id: customers.id,
      legacyId: customers.legacyId,
      gradeId: customers.gradeId,
      gradeNameEn: customerGrades.nameEn,
      gradeNameZh: customerGrades.nameZh,
      nameZh: customers.nameZh,
      nameEn: customers.nameEn,
      phone: customers.phone,
      email: customers.email,
      pointsBalance: customers.pointsBalance,
      active: customers.active,
      cardNo: sql<string | null>`(SELECT mc.card_no FROM member_cards mc WHERE mc.customer_id = ${customers.id} AND mc.active = 1 ORDER BY mc.id LIMIT 1)`,
    })
    .from(customers)
    .leftJoin(customerGrades, eq(customers.gradeId, customerGrades.id))
    .where(
      pattern
        ? or(
            like(customers.legacyId, pattern),
            like(customers.nameZh, pattern),
            like(customers.nameEn, pattern),
            like(customers.phone, pattern),
            sql`EXISTS (SELECT 1 FROM member_cards mc WHERE mc.customer_id = ${customers.id} AND mc.card_no LIKE ${pattern})`,
          )
        : undefined,
    )
    .orderBy(desc(customers.pointsBalance), customers.id)
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({
    ...r,
    gradeName: r.gradeNameZh || r.gradeNameEn || "",
    cardNo: r.cardNo ?? "",
  }));
}

export async function countCustomers(q?: string) {
  const conn = requireSharedDb();
  const pattern = q?.trim() ? `%${q.trim()}%` : undefined;
  const [row] = await conn.db
    .select({ total: sql<number>`COUNT(*)` })
    .from(customers)
    .where(
      pattern
        ? or(
            like(customers.legacyId, pattern),
            like(customers.nameZh, pattern),
            like(customers.nameEn, pattern),
            like(customers.phone, pattern),
            sql`EXISTS (SELECT 1 FROM member_cards mc WHERE mc.customer_id = ${customers.id} AND mc.card_no LIKE ${pattern})`,
          )
        : undefined,
    );
  return Number(row?.total ?? 0);
}

export async function listCustomerGrades() {
  const conn = requireSharedDb();
  return conn.db.select().from(customerGrades).orderBy(customerGrades.legacyCode);
}

export async function listStaffPage(params: { q?: string; page?: number; pageSize?: number }) {
  const conn = requireSharedDb();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 12));
  const pattern = params.q?.trim() ? `%${params.q.trim()}%` : undefined;
  const filter = pattern
    ? or(like(staff.legacyId, pattern), like(staff.displayName, pattern))
    : undefined;
  const [rows, countRows] = await Promise.all([
    conn.db
      .select({
        id: staff.id,
        legacyId: staff.legacyId,
        displayName: staff.displayName,
        roleLevel: staffRoles.legacyAuthorityLevel,
        active: staff.active,
      })
      .from(staff)
      .innerJoin(staffRoles, eq(staff.roleId, staffRoles.id))
      .where(filter)
      .orderBy(staff.legacyId, staff.id)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    conn.db.select({ total: sql<number>`COUNT(*)` }).from(staff).where(filter),
  ]);
  const total = Number(countRows[0]?.total ?? 0);
  return { items: rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

async function syncCustomerCardNo(db: HarpDb, customerId: number, cardNo?: string) {
  if (cardNo === undefined) return;
  const cleanCard = cardNo.trim();
  await db
    .update(memberCards)
    .set({ active: false })
    .where(
      cleanCard
        ? and(eq(memberCards.customerId, customerId), ne(memberCards.cardNo, cleanCard))
        : eq(memberCards.customerId, customerId),
    );
  if (!cleanCard) return;

  const existingCard = await db
    .select()
    .from(memberCards)
    .where(eq(memberCards.cardNo, cleanCard))
    .limit(1);
  if (existingCard.length > 0) {
    await db
      .update(memberCards)
      .set({ customerId, active: true })
      .where(eq(memberCards.id, existingCard[0]!.id));
  } else {
    await db.insert(memberCards).values({ customerId, cardNo: cleanCard, active: true });
  }
}

export async function upsertCustomerRecord(input: {
  id?: number;
  legacyId?: string;
  gradeId?: number | null;
  cardNo?: string;
  nameZh: string;
  nameEn?: string;
  phone?: string;
  email?: string;
}) {
  const conn = requireSharedDb();
  if (input.id) {
    const existingById = await conn.db.select().from(customers).where(eq(customers.id, input.id)).limit(1);
    if (existingById.length > 0) {
      await conn.db
        .update(customers)
        .set({
          gradeId: input.gradeId !== undefined ? input.gradeId : existingById[0]!.gradeId,
          nameZh: input.nameZh,
          nameEn: input.nameEn ?? existingById[0]!.nameEn,
          phone: input.phone ?? existingById[0]!.phone,
          email: input.email ?? existingById[0]!.email,
        })
        .where(eq(customers.id, existingById[0]!.id));
      await syncCustomerCardNo(conn.db, existingById[0]!.id, input.cardNo);
      return { ok: true, id: existingById[0]!.id, legacyId: existingById[0]!.legacyId };
    }
  }
  const idKey = input.legacyId?.trim() || `CUST${Date.now().toString().slice(-8)}`;
  const existing = await conn.db.select().from(customers).where(eq(customers.legacyId, idKey)).limit(1);
  if (existing.length > 0) {
    await conn.db
      .update(customers)
      .set({
        gradeId: input.gradeId !== undefined ? input.gradeId : existing[0]!.gradeId,
        nameZh: input.nameZh,
        nameEn: input.nameEn ?? existing[0]!.nameEn,
        phone: input.phone ?? existing[0]!.phone,
        email: input.email ?? existing[0]!.email,
      })
      .where(eq(customers.id, existing[0]!.id));
    await syncCustomerCardNo(conn.db, existing[0]!.id, input.cardNo);
    return { ok: true, id: existing[0]!.id, legacyId: idKey };
  }
  const res = await conn.db.insert(customers).values({
    legacyId: idKey,
    gradeId: input.gradeId ?? null,
    nameZh: input.nameZh,
    nameEn: input.nameEn ?? "",
    phone: input.phone ?? "",
    email: input.email ?? "",
    pointsBalance: 0,
    active: true,
  });
  const newId = Number(res[0].insertId);
  await syncCustomerCardNo(conn.db, newId, input.cardNo);
  return { ok: true, id: newId, legacyId: idKey };
}

function buildSupplierFilter(q?: string) {
  const clean = q?.trim();
  if (!clean) return undefined;
  const pattern = `%${clean}%`;
  return or(
    like(suppliers.legacyId, pattern),
    like(suppliers.nameZh, pattern),
    like(suppliers.nameEn, pattern),
    like(suppliers.phone, pattern),
  );
}

export async function listSuppliers(params?: { q?: string; limit?: number }) {
  const conn = requireSharedDb();
  const limit = Math.min(params?.limit ?? 100, 200);
  const filter = buildSupplierFilter(params?.q);
  return conn.db
    .select()
    .from(suppliers)
    .where(filter)
    .orderBy(suppliers.legacyId)
    .limit(limit);
}

export async function countSuppliers(q?: string) {
  const conn = requireSharedDb();
  const filter = buildSupplierFilter(q);
  const [row] = await conn.db
    .select({ total: sql<number>`COUNT(*)` })
    .from(suppliers)
    .where(filter);
  return Number(row?.total ?? 0);
}

export async function upsertSupplierRecord(input: {
  id?: number;
  legacyId?: string;
  nameZh: string;
  nameEn?: string;
  phone?: string;
  active?: boolean;
}) {
  const conn = requireSharedDb();
  const cleanLegacyId = input.legacyId?.trim();
  if (input.id) {
    const existingById = await conn.db.select().from(suppliers).where(eq(suppliers.id, input.id)).limit(1);
    if (existingById.length > 0) {
      const nextLegacyId = cleanLegacyId || existingById[0]!.legacyId;
      await conn.db
        .update(suppliers)
        .set({
          legacyId: nextLegacyId,
          nameZh: input.nameZh,
          nameEn: input.nameEn ?? existingById[0]!.nameEn,
          phone: input.phone ?? existingById[0]!.phone,
          active: input.active ?? existingById[0]!.active,
        })
        .where(eq(suppliers.id, existingById[0]!.id));
      return { ok: true, id: existingById[0]!.id, legacyId: nextLegacyId };
    }
  }

  const idKey = cleanLegacyId || `SUP${Date.now().toString().slice(-6)}`;
  const existing = await conn.db.select().from(suppliers).where(eq(suppliers.legacyId, idKey)).limit(1);
  if (existing.length > 0) {
    await conn.db
      .update(suppliers)
      .set({
        nameZh: input.nameZh,
        nameEn: input.nameEn ?? existing[0]!.nameEn,
        phone: input.phone ?? existing[0]!.phone,
        active: input.active ?? existing[0]!.active,
      })
      .where(eq(suppliers.id, existing[0]!.id));
    return { ok: true, id: existing[0]!.id, legacyId: idKey };
  }

  const res = await conn.db.insert(suppliers).values({
    legacyId: idKey,
    nameZh: input.nameZh,
    nameEn: input.nameEn ?? "",
    phone: input.phone ?? "",
    active: input.active ?? true,
  });
  return { ok: true, id: Number(res[0].insertId), legacyId: idKey };
}

export async function listOpenInvoices(limit = 50) {
  const conn = getSharedDb();
  if (!conn) return null;
  return listInvoices({ statusFilter: "open", limit });
}

export async function listInvoices(params: {
  statusFilter?: "open" | "paid" | "all";
  q?: string;
  limit?: number;
}) {
  const conn = requireSharedDb();
  const limit = Math.min(params.limit ?? 60, 200);
  const filters = [];

  if (params.statusFilter === "open" || !params.statusFilter) {
    filters.push(inArray(bills.paymentStatus, ["unpaid", "partial"]));
    filters.push(sql`${bills.balanceDue} > 0`);
    filters.push(sql`${bills.status} <> 'cancelled'`);
  } else if (params.statusFilter === "paid") {
    filters.push(eq(bills.paymentStatus, "paid"));
  }
  if (params.q?.trim()) {
    const p = `%${params.q.trim()}%`;
    filters.push(or(like(bills.invoiceNo, p), like(bills.legacySc, p), like(bills.notes, p)));
  }

  const rows = await conn.db
    .select({
      id: bills.id,
      invoiceNo: bills.invoiceNo,
      docType: bills.docType,
      status: bills.status,
      paymentStatus: bills.paymentStatus,
      businessDate: bills.businessDate,
      netAmount: bills.netAmount,
      paidAmount: bills.paidAmount,
      balanceDue: bills.balanceDue,
      issuedAt: bills.issuedAt,
      paidAt: bills.paidAt,
      customerNameZh: customers.nameZh,
      customerNameEn: customers.nameEn,
    })
    .from(bills)
    .leftJoin(customers, eq(bills.customerId, customers.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(bills.issuedAt), desc(bills.id))
    .limit(limit);

  if (rows.length === 0) return [];
  const billIds = rows.map((r) => r.id);
  const pmts = await conn.db
    .select({
      billId: billPayments.billId,
      tenderCode: billPayments.tenderCode,
      amount: billPayments.amount,
      paidAt: billPayments.paidAt,
      referenceNo: billPayments.referenceNo,
    })
    .from(billPayments)
    .where(and(inArray(billPayments.billId, billIds), eq(billPayments.voided, false)));

  const pmtsByBill = new Map<number, typeof pmts>();
  for (const p of pmts) {
    const arr = pmtsByBill.get(p.billId) ?? [];
    arr.push(p);
    pmtsByBill.set(p.billId, arr);
  }

  return rows.map((b) => ({
    invoiceNo: b.invoiceNo,
    docType: b.docType,
    status: b.status,
    paymentStatus: b.paymentStatus,
    customerName: b.customerNameEn || b.customerNameZh || "Walk-In / Customer",
    netAmountHkd: Number(b.netAmount),
    paidAmountHkd: Number(b.paidAmount),
    balanceDueHkd: Number(b.balanceDue),
    issuedAtIso: b.issuedAt.toISOString(),
    paidAtIso: b.paidAt ? b.paidAt.toISOString() : undefined,
    payments: (pmtsByBill.get(b.id) ?? []).map((p) => ({
      tenderCode: p.tenderCode,
      amountHkd: Number(p.amount),
      paidAtIso: p.paidAt.toISOString(),
      referenceNo: p.referenceNo ?? undefined,
    })),
  }));
}

export type BillQueryView = "today" | "held" | "office" | "unprocessed";
export type BillQuerySubFilter = "all" | "last30" | "completed" | "cancelled" | "deposit";

export async function listBillQuery(
  viewOrParams:
    | BillQueryView
    | {
        view: BillQueryView;
        shopId: number;
        q?: string;
        date?: string;
        subFilter?: BillQuerySubFilter;
      },
  shopIdArg?: number,
) {
  const conn = requireSharedDb();
  const today = formatHktBusinessDate();
  const view = typeof viewOrParams === "string" ? viewOrParams : viewOrParams.view;
  const shopId = typeof viewOrParams === "string" ? (shopIdArg ?? 1) : viewOrParams.shopId;
  const q = typeof viewOrParams === "string" ? undefined : viewOrParams.q?.trim();
  const date = typeof viewOrParams === "string" ? undefined : viewOrParams.date?.trim();
  const subFilter = (typeof viewOrParams === "string" ? "all" : viewOrParams.subFilter) ?? "all";
  const retailTypes = ["RETAIL_SALE", "SALES_INVOICE", "SALES_RETURN"];
  const filters = [eq(bills.shopId, shopId)];

  if (view === "today") {
    if (date !== "ALL") {
      filters.push(eq(bills.businessDate, date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today));
    }
    filters.push(inArray(bills.docType, retailTypes), ne(bills.sourceTable, "OfficeXHeader"));
  } else if (view === "held") {
    filters.push(inArray(bills.status, ["held", "intraday"]));
  } else if (view === "office") {
    filters.push(
      sql`(${bills.docType} NOT IN ('RETAIL_SALE', 'SALES_INVOICE', 'SALES_RETURN') OR ${bills.sourceTable} = 'OfficeXHeader')`,
    );
  } else {
    filters.push(
      sql`${bills.status} <> 'cancelled'`,
      sql`(${bills.status} IN ('open', 'held', 'intraday') OR ${bills.balanceDue} > 0 OR ${deliveryOrders.deliveryStatus} = 'pending')`,
    );
  }

  if (subFilter === "completed") {
    filters.push(inArray(bills.status, ["completed", "sealed"]), eq(bills.paymentStatus, "paid"));
  } else if (subFilter === "cancelled") {
    filters.push(eq(bills.status, "cancelled"));
  } else if (subFilter === "deposit") {
    filters.push(ne(bills.status, "cancelled"), sql`${bills.balanceDue} > 0`);
  }

  if (q) {
    const p = `%${q}%`;
    filters.push(
      or(
        like(bills.invoiceNo, p),
        like(bills.legacySc, p),
        like(bills.notes, p),
        like(customers.legacyId, p),
        like(customers.nameZh, p),
        like(customers.nameEn, p),
        like(customers.phone, p),
      )!,
    );
  }

  const rows = await conn.db
    .select({
      id: bills.id,
      invoiceNo: bills.invoiceNo,
      docType: bills.docType,
      status: bills.status,
      paymentStatus: bills.paymentStatus,
      businessDate: bills.businessDate,
      netAmount: bills.netAmount,
      balanceDue: bills.balanceDue,
      issuedAt: bills.issuedAt,
      customerNameZh: customers.nameZh,
      customerNameEn: customers.nameEn,
      deliveryStatus: deliveryOrders.deliveryStatus,
    })
    .from(bills)
    .leftJoin(customers, eq(bills.customerId, customers.id))
    .leftJoin(deliveryOrders, eq(deliveryOrders.billId, bills.id))
    .where(and(...filters))
    .orderBy(desc(bills.issuedAt), desc(bills.id))
    .limit(subFilter === "last30" ? 30 : 200);

  return rows.map((row) => ({
    invoiceNo: row.invoiceNo,
    docType: row.docType,
    status: row.status,
    paymentStatus: row.paymentStatus,
    businessDate: row.businessDate,
    customerName: row.customerNameZh || row.customerNameEn || "散客",
    netAmountHkd: Number(row.netAmount),
    balanceDueHkd: Number(row.balanceDue),
    issuedAtIso: row.issuedAt.toISOString(),
    deliveryStatus: row.deliveryStatus,
  }));
}

export async function getInvoiceDetailByNo(invoiceNo: string) {
  const conn = requireSharedDb();
  const [bill] = await conn.db
    .select({
      id: bills.id,
      shopId: bills.shopId,
      terminalId: bills.terminalId,
      invoiceNo: bills.invoiceNo,
      docType: bills.docType,
      status: bills.status,
      paymentStatus: bills.paymentStatus,
      businessDate: bills.businessDate,
      grossAmount: bills.grossAmount,
      discountAmount: bills.discountAmount,
      netAmount: bills.netAmount,
      paidAmount: bills.paidAmount,
      balanceDue: bills.balanceDue,
      issuedAt: bills.issuedAt,
      paidAt: bills.paidAt,
      notes: bills.notes,
      customerId: customers.id,
      customerLegacyId: customers.legacyId,
      customerNameZh: customers.nameZh,
      customerNameEn: customers.nameEn,
      customerPhone: customers.phone,
      customerPointsBalance: customers.pointsBalance,
    })
    .from(bills)
    .leftJoin(customers, eq(bills.customerId, customers.id))
    .where(eq(bills.invoiceNo, invoiceNo))
    .limit(1);

  if (!bill) return null;

  const [lines, pmts, settings, deliveries] = await Promise.all([
    conn.db.select().from(billLines).where(eq(billLines.billId, bill.id)).orderBy(billLines.lineNo),
    conn.db
      .select()
      .from(billPayments)
      .where(and(eq(billPayments.billId, bill.id), eq(billPayments.voided, false)))
      .orderBy(billPayments.paidAt),
    getAppSettings(),
    conn.db.select().from(deliveryOrders).where(eq(deliveryOrders.billId, bill.id)).limit(1),
  ]);

  return {
    bill: {
      invoiceNo: bill.invoiceNo,
      docType: bill.docType,
      status: bill.status,
      paymentStatus: bill.paymentStatus,
      businessDate: bill.businessDate,
      grossAmountHkd: Number(bill.grossAmount),
      discountAmountHkd: Number(bill.discountAmount),
      netAmountHkd: Number(bill.netAmount),
      paidAmountHkd: Number(bill.paidAmount),
      balanceDueHkd: Number(bill.balanceDue),
      issuedAtIso: bill.issuedAt.toISOString(),
      paidAtIso: bill.paidAt?.toISOString(),
      notes: bill.notes,
      deliveryStatus: deliveries[0]?.deliveryStatus ?? null,
      customer: bill.customerLegacyId
        ? {
            id: bill.customerId!,
            legacyId: bill.customerLegacyId,
            nameZh: bill.customerNameZh ?? "",
            nameEn: bill.customerNameEn ?? "",
            phone: bill.customerPhone ?? "",
            pointsBalance: bill.customerPointsBalance ?? 0,
          }
        : null,
    },
    lines: lines.map((l) => ({
      lineNo: l.lineNo,
      sku: l.sku,
      nameZh: l.nameZh,
      nameEn: l.nameEn,
      categoryC1: l.categoryC1,
      quantity: Number(l.quantity),
      unitPriceHkd: Number(l.unitPrice),
      discountRate: Number(l.discountRate),
      lineTotalHkd: Number(l.lineTotal),
      cancelled: l.cancelled,
      dk: l.legacyDk,
    })),
    payments: pmts.map((p) => ({
      tenderCode: p.tenderCode,
      amountHkd: Number(p.amount),
      paidAtIso: p.paidAt.toISOString(),
      approvalCode: p.approvalCode,
      cardLast4: p.cardLast4,
      referenceNo: p.referenceNo,
    })),
    settings,
  };
}

export async function listStockOverview(params: { q?: string; limit?: number; shopId?: number }) {
  const conn = requireSharedDb();
  const storeCtx = await resolveActiveStoreContext();
  const targetShopId = params.shopId ?? storeCtx.shopId;
  const q = params.q?.trim();
  const limit = Math.min(params.limit ?? 80, 200);
  const pattern = q ? `%${q}%` : undefined;

  const rows = await conn.db
    .select({
      productId: products.id,
      sku: products.barcode,
      nameZh: products.nameZh,
      nameEn: products.nameEn,
      categoryC1: products.legacyC1,
      sellPrice: products.sellPrice,
      onHandQty: stockBalances.onHandQty,
      movingAvgCost: stockBalances.movingAvgCost,
    })
    .from(products)
    .leftJoin(
      stockBalances,
      and(eq(stockBalances.productId, products.id), eq(stockBalances.shopId, targetShopId)),
    )
    .where(
      pattern
        ? or(like(products.barcode, pattern), like(products.ubc, pattern), like(products.nameEn, pattern), like(products.nameZh, pattern))
        : undefined,
    )
    .orderBy(products.barcode)
    .limit(limit);

  return rows.map((r) => ({
    productId: r.productId,
    sku: r.sku,
    nameZh: r.nameZh,
    nameEn: r.nameEn || r.nameZh,
    categoryC1: r.categoryC1,
    sellPriceHkd: Number(r.sellPrice),
    onHandQty: Number(r.onHandQty ?? 0),
    movingAvgCostHkd: Number(r.movingAvgCost ?? 0),
    valuationHkd: Number(((Number(r.onHandQty ?? 0) * Number(r.movingAvgCost ?? 0))).toFixed(2)),
  }));
}

export async function listStockPage(params: {
  q?: string;
  categoryC1?: number;
  page?: number;
  pageSize?: number;
  shopId: number;
}) {
  const conn = requireSharedDb();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 80));
  const pattern = params.q?.trim() ? `%${params.q.trim()}%` : undefined;
  const filters = [];
  if (pattern) {
    filters.push(
      or(
        like(products.barcode, pattern),
        like(products.ubc, pattern),
        like(products.nameEn, pattern),
        like(products.nameZh, pattern),
      ),
    );
  }
  if (params.categoryC1 !== undefined && Number.isFinite(params.categoryC1)) {
    filters.push(eq(products.legacyC1, params.categoryC1));
  }
  const whereClause = filters.length > 0 ? and(...filters) : undefined;
  const [countRow] = await conn.db.select({ count: sql<number>`COUNT(*)` }).from(products).where(whereClause);
  const total = Number(countRow?.count ?? 0);
  const rows = await conn.db
    .select({
      productId: products.id,
      sku: products.barcode,
      nameZh: products.nameZh,
      nameEn: products.nameEn,
      categoryC1: products.legacyC1,
      sellPrice: products.sellPrice,
      onHandQty: stockBalances.onHandQty,
      movingAvgCost: stockBalances.movingAvgCost,
    })
    .from(products)
    .leftJoin(
      stockBalances,
      and(eq(stockBalances.productId, products.id), eq(stockBalances.shopId, params.shopId)),
    )
    .where(whereClause)
    .orderBy(products.barcode)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    items: rows.map((row) => ({
      productId: row.productId,
      sku: row.sku,
      nameZh: row.nameZh,
      nameEn: row.nameEn || row.nameZh,
      categoryC1: row.categoryC1,
      sellPriceHkd: Number(row.sellPrice),
      onHandQty: Number(row.onHandQty ?? 0),
      movingAvgCostHkd: Number(row.movingAvgCost ?? 0),
      valuationHkd: Number((Number(row.onHandQty ?? 0) * Number(row.movingAvgCost ?? 0)).toFixed(2)),
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function listStockMovements(productId: number, shopId: number, limit = 40) {
  const conn = requireSharedDb();
  const rows = await conn.db
    .select({
      id: stockMovements.id,
      movementType: stockMovements.movementType,
      legacyXc: stockMovements.legacyXc,
      onHandDelta: stockMovements.onHandDelta,
      unitCost: stockMovements.unitCost,
      movingAvgCostAfter: stockMovements.movingAvgCostAfter,
      createdAt: stockMovements.createdAt,
      invoiceNo: bills.invoiceNo,
    })
    .from(stockMovements)
    .leftJoin(bills, eq(stockMovements.billId, bills.id))
    .where(and(eq(stockMovements.shopId, shopId), eq(stockMovements.productId, productId)))
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .limit(Math.min(100, Math.max(1, limit)));

  return rows.map((r) => ({
    id: r.id,
    movementType: r.movementType,
    legacyXc: r.legacyXc,
    onHandDelta: Number(r.onHandDelta),
    unitCostHkd: Number(r.unitCost),
    movingAvgCostAfterHkd: Number(r.movingAvgCostAfter),
    invoiceNo: r.invoiceNo ?? null,
    createdAtIso: r.createdAt.toISOString(),
  }));
}

export async function getDayEndPreview(businessDate: string, shopId?: number) {
  const conn = requireSharedDb();
  const targetShopId = shopId ?? (await resolveActiveStoreContext()).shopId;

  const [salesAgg] = await conn.db
    .select({
      billCount: sql<number>`COUNT(*)`,
      issuedTotal: sql<string>`COALESCE(SUM(CASE WHEN ${bills.docType} = 'SALES_RETURN' THEN -${bills.netAmount} ELSE ${bills.netAmount} END), 0)`,
      unpaidIssuedTotal: sql<string>`COALESCE(SUM(${bills.balanceDue}), 0)`,
    })
    .from(bills)
    .where(
      and(
        eq(bills.shopId, targetShopId),
        eq(bills.businessDate, businessDate),
        sql`${bills.status} <> 'cancelled'`,
        inArray(bills.docType, [...SALES_DOC_TYPES]),
      ),
    );

  const tenderRows = await conn.db
    .select({
      tenderCode: billPayments.tenderCode,
      txCount: sql<number>`COUNT(*)`,
      collectedTotal: sql<string>`COALESCE(SUM(CASE WHEN ${bills.docType} IN ('SALES_RETURN', 'PETTY_PAYOUT') THEN -${billPayments.amount} ELSE ${billPayments.amount} END), 0)`,
    })
    .from(billPayments)
    .innerJoin(bills, eq(billPayments.billId, bills.id))
    .where(
      and(
        eq(bills.shopId, targetShopId),
        eq(billPayments.businessDate, businessDate),
        eq(billPayments.voided, false),
        sql`${bills.status} <> 'cancelled'`,
      ),
    )
    .groupBy(billPayments.tenderCode);

  const [recentBatches, floatRows] = await Promise.all([
    conn.db
      .select()
      .from(dayEndBatches)
      .where(eq(dayEndBatches.shopId, targetShopId))
      .orderBy(desc(dayEndBatches.businessDate), desc(dayEndBatches.batchNo))
      .limit(12),
    conn.db
      .select()
      .from(appSettings)
      .where(and(eq(appSettings.shopId, targetShopId), eq(appSettings.settingKey, `opening_float_${businessDate}`)))
      .limit(1),
  ]);

  const floatVal = (floatRows[0]?.settingValue ?? {}) as { amountHkd?: number };

  return {
    businessDate,
    openingFloatHkd: Number(floatVal.amountHkd ?? 0),
    billCount: Number(salesAgg?.billCount ?? 0),
    issuedSalesTotalHkd: Number(salesAgg?.issuedTotal ?? 0),
    unpaidIssuedBalanceHkd: Number(salesAgg?.unpaidIssuedTotal ?? 0),
    collectedByTender: tenderRows.map((t) => ({
      tenderCode: t.tenderCode,
      txCount: Number(t.txCount),
      collectedAmountHkd: Number(t.collectedTotal),
    })),
    recentBatches: recentBatches.map((b) => ({
      id: b.id,
      businessDate: b.businessDate,
      batchNo: b.batchNo,
      status: b.status,
      issuedSalesTotalHkd: Number(b.issuedSalesTotal),
      collectedPaymentsTotalHkd: Number(b.collectedPaymentsTotal),
      closedAtIso: b.closedAt?.toISOString() ?? null,
    })),
  };
}

export async function getOperationalReports(params: { fromDate: string; toDate: string; shopId?: number }) {
  const conn = requireSharedDb();
  const targetShopId = params.shopId ?? (await resolveActiveStoreContext()).shopId;

  const [tenderRows, categoryRows, arSummary, stockVal, recentAudits] = await Promise.all([
    conn.db
      .select({
        tenderCode: billPayments.tenderCode,
        txCount: sql<number>`COUNT(*)`,
        totalHkd: sql<string>`COALESCE(SUM(CASE WHEN ${bills.docType} IN ('SALES_RETURN', 'PETTY_PAYOUT') THEN -${billPayments.amount} ELSE ${billPayments.amount} END), 0)`,
      })
      .from(billPayments)
      .innerJoin(bills, eq(billPayments.billId, bills.id))
      .where(
        and(
          eq(bills.shopId, targetShopId),
          eq(billPayments.voided, false),
          sql`${bills.status} <> 'cancelled'`,
          sql`${billPayments.businessDate} >= ${params.fromDate}`,
          sql`${billPayments.businessDate} <= ${params.toDate}`,
        ),
      )
      .groupBy(billPayments.tenderCode)
      .orderBy(desc(sql`SUM(CASE WHEN ${bills.docType} IN ('SALES_RETURN', 'PETTY_PAYOUT') THEN -${billPayments.amount} ELSE ${billPayments.amount} END)`)),
    conn.db
      .select({
        categoryC1: billLines.categoryC1,
        lineCount: sql<number>`COUNT(*)`,
        totalHkd: sql<string>`COALESCE(SUM(CASE WHEN ${bills.docType} = 'SALES_RETURN' THEN -${billLines.lineTotal} ELSE ${billLines.lineTotal} END), 0)`,
      })
      .from(billLines)
      .innerJoin(bills, eq(billLines.billId, bills.id))
      .where(
        and(
          eq(bills.shopId, targetShopId),
          eq(billLines.cancelled, false),
          sql`${billLines.legacyDk} > 0`,
          sql`${bills.status} <> 'cancelled'`,
          inArray(bills.docType, [...SALES_DOC_TYPES]),
          sql`${bills.businessDate} >= ${params.fromDate}`,
          sql`${bills.businessDate} <= ${params.toDate}`,
        ),
      )
      .groupBy(billLines.categoryC1)
      .orderBy(desc(sql`SUM(CASE WHEN ${bills.docType} = 'SALES_RETURN' THEN -${billLines.lineTotal} ELSE ${billLines.lineTotal} END)`))
      .limit(15),
    conn.db
      .select({
        openInvoices: sql<number>`COUNT(*)`,
        totalBalanceDue: sql<string>`COALESCE(SUM(${bills.balanceDue}), 0)`,
      })
      .from(bills)
      .where(
        and(
          eq(bills.shopId, targetShopId),
          sql`${bills.status} <> 'cancelled'`,
          inArray(bills.paymentStatus, ["unpaid", "partial"]),
          sql`${bills.balanceDue} > 0`,
        ),
      ),
    conn.db
      .select({
        skuCount: sql<number>`COUNT(*)`,
        totalQty: sql<string>`COALESCE(SUM(${stockBalances.onHandQty}), 0)`,
        totalValuation: sql<string>`COALESCE(SUM(${stockBalances.onHandQty} * ${stockBalances.movingAvgCost}), 0)`,
      })
      .from(stockBalances)
      .where(and(eq(stockBalances.shopId, targetShopId), sql`${stockBalances.onHandQty} > 0`)),
    conn.db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(25),
  ]);

  return {
    range: { fromDate: params.fromDate, toDate: params.toDate },
    salesByTender: tenderRows.map((r) => ({
      tenderCode: r.tenderCode,
      txCount: Number(r.txCount),
      totalHkd: Number(r.totalHkd),
    })),
    salesByCategory: categoryRows.map((r) => ({
      categoryC1: r.categoryC1,
      lineCount: Number(r.lineCount),
      totalHkd: Number(r.totalHkd),
    })),
    arAgingSummary: {
      openInvoices: Number(arSummary[0]?.openInvoices ?? 0),
      totalBalanceDueHkd: Number(arSummary[0]?.totalBalanceDue ?? 0),
    },
    stockValuation: {
      positiveSkuCount: Number(stockVal[0]?.skuCount ?? 0),
      totalUnits: Number(stockVal[0]?.totalQty ?? 0),
      totalValuationHkd: Number(stockVal[0]?.totalValuation ?? 0),
    },
    recentAudits: recentAudits.map((a) => ({
      id: a.id,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      createdAtIso: a.createdAt.toISOString(),
      details: a.details,
    })),
  };
}

export async function getAppSettings(): Promise<Record<string, Record<string, unknown>>> {
  const conn = requireSharedDb();
  const rows = await conn.db.select().from(appSettings);
  const out: Record<string, Record<string, unknown>> = {};
  for (const r of rows) {
    out[r.settingKey] = (r.settingValue ?? {}) as Record<string, unknown>;
  }
  return out;
}

export async function upsertAppSetting(key: string, value: Record<string, unknown>, shopId = 0) {
  const conn = requireSharedDb();
  await conn.pool.query(
    "INSERT INTO app_settings (shop_id, setting_key, setting_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP",
    [shopId, key, JSON.stringify(value)],
  );
  return { ok: true, key };
}

export async function getCustomerPointLedger(customerId: number) {
  const conn = requireSharedDb();
  return conn.db
    .select()
    .from(crmPointLedger)
    .where(eq(crmPointLedger.customerId, customerId))
    .orderBy(desc(crmPointLedger.createdAt))
    .limit(30);
}
