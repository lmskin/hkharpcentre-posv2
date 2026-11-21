import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import type mysql from "mysql2/promise";
import { createDb, type HarpDb } from "./client";
import { verifySecret } from "./auth";
import { auditLogs, shops, staff, staffRoles } from "./schema/org-auth";
import { categories, posMenuButtons, posMenus, products, units } from "./schema/catalog";
import { crmPointLedger, customers } from "./schema/crm";
import { billLines, bills } from "./schema/sales-ar";
import { billPayments } from "./schema/payments";
import { appSettings, dayEndBatches, stockBalances } from "./schema/stock-ops";
import { formatHktBusinessDate } from "./transactions";

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
      return {
        staffId: r.id,
        legacyId: r.legacyId ?? String(r.id),
        displayName: r.displayName,
        roleLevel: r.roleLevel,
        shopId: r.shopId,
      };
    }
  }
  return null;
}

export async function getDashboardSummary() {
  const conn = getSharedDb();
  if (!conn) return null;
  const today = formatHktBusinessDate();

  const [countsRow] = await conn.db
    .select({
      productCount: sql<number>`(SELECT COUNT(*) FROM products)`,
      customerCount: sql<number>`(SELECT COUNT(*) FROM customers)`,
      billCount: sql<number>`(SELECT COUNT(*) FROM bills)`,
      openArCount: sql<number>`(SELECT COUNT(*) FROM bills WHERE payment_status IN ('unpaid','partial') AND balance_due > 0 AND status <> 'cancelled')`,
      openArTotal: sql<string>`(SELECT COALESCE(SUM(balance_due), 0) FROM bills WHERE payment_status IN ('unpaid','partial') AND balance_due > 0 AND status <> 'cancelled')`,
      todayIssuedSales: sql<string>`(SELECT COALESCE(SUM(net_amount), 0) FROM bills WHERE business_date = ${today} AND status <> 'cancelled')`,
      todayCollectedPayments: sql<string>`(SELECT COALESCE(SUM(amount), 0) FROM bill_payments WHERE business_date = ${today} AND voided = 0)`,
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
      nameZh: products.nameZh,
      nameEn: products.nameEn,
      categoryC1: products.legacyC1,
      categoryNameEn: categories.nameEn,
      sellPrice: products.sellPrice,
      avgCost: products.avgCost,
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
    nameZh: r.nameZh,
    nameEn: r.nameEn || r.nameZh,
    categoryLabel: `${r.categoryNameEn ?? "General"} (C1=${r.categoryC1})`,
    categoryC1: r.categoryC1,
    unitPriceHkd: Number(r.sellPrice),
    avgCostHkd: Number(r.avgCost),
    excludeFromCrmBonus: r.excludeFromCrmBonus,
    active: r.active,
  }));
}

export async function searchProducts(params: { q?: string; categoryC1?: number; limit?: number }) {
  const conn = requireSharedDb();
  const q = params.q?.trim();
  const limit = Math.min(params.limit ?? 60, 200);

  const filters = [];
  if (q) {
    const pattern = `%${q}%`;
    filters.push(or(like(products.barcode, pattern), like(products.nameEn, pattern), like(products.nameZh, pattern)));
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
      avgCost: products.avgCost,
      excludeFromCrmBonus: products.excludeFromCrmBonus,
      active: products.active,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
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
    avgCostHkd: Number(r.avgCost),
    excludeFromCrmBonus: r.excludeFromCrmBonus,
    active: r.active,
  }));
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
  nameZh: string;
  nameEn: string;
  legacyC1: number;
  sellPriceHkd: number;
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
        nameZh: input.nameZh,
        nameEn: input.nameEn,
        legacyC1: input.legacyC1,
        categoryId: cat?.id ?? existing[0]!.categoryId,
        sellPrice: input.sellPriceHkd.toFixed(4),
        excludeFromCrmBonus: input.excludeFromCrmBonus ?? existing[0]!.excludeFromCrmBonus,
        updatedAt: new Date(),
      })
      .where(eq(products.id, existing[0]!.id));
    return { ok: true, id: existing[0]!.id, created: false };
  }

  const res = await conn.db.insert(products).values({
    shopId,
    barcode: input.barcode,
    nameZh: input.nameZh,
    nameEn: input.nameEn,
    legacyC1: input.legacyC1,
    categoryId: cat?.id ?? null,
    sellPrice: input.sellPriceHkd.toFixed(4),
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
      nameZh: products.nameZh,
      nameEn: products.nameEn,
      categoryC1: products.legacyC1,
      sellPrice: products.sellPrice,
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
        nameZh: b.nameZh ?? b.labelZh,
        nameEn: b.nameEn || b.labelEn,
        categoryC1: b.categoryC1 ?? 0,
        unitPriceHkd: Number(b.sellPrice ?? 0),
        excludeFromCrmBonus: b.excludeFromCrmBonus ?? false,
      })),
  }));
}

export async function searchCustomers(params: { q?: string; limit?: number }) {
  const conn = requireSharedDb();
  const q = params.q?.trim();
  const limit = Math.min(params.limit ?? 50, 200);
  const pattern = q ? `%${q}%` : undefined;

  const rows = await conn.db
    .select({
      id: customers.id,
      legacyId: customers.legacyId,
      nameZh: customers.nameZh,
      nameEn: customers.nameEn,
      phone: customers.phone,
      email: customers.email,
      pointsBalance: customers.pointsBalance,
      active: customers.active,
    })
    .from(customers)
    .where(
      pattern
        ? or(
            like(customers.legacyId, pattern),
            like(customers.nameZh, pattern),
            like(customers.nameEn, pattern),
            like(customers.phone, pattern),
          )
        : undefined,
    )
    .orderBy(desc(customers.pointsBalance), customers.id)
    .limit(limit);

  return rows;
}

export async function upsertCustomerRecord(input: {
  legacyId?: string;
  nameZh: string;
  nameEn?: string;
  phone?: string;
  email?: string;
}) {
  const conn = requireSharedDb();
  const idKey = input.legacyId?.trim() || `CUST${Date.now().toString().slice(-8)}`;
  const existing = await conn.db.select().from(customers).where(eq(customers.legacyId, idKey)).limit(1);
  if (existing.length > 0) {
    await conn.db
      .update(customers)
      .set({
        nameZh: input.nameZh,
        nameEn: input.nameEn ?? existing[0]!.nameEn,
        phone: input.phone ?? existing[0]!.phone,
        email: input.email ?? existing[0]!.email,
      })
      .where(eq(customers.id, existing[0]!.id));
    return { ok: true, id: existing[0]!.id, legacyId: idKey };
  }
  const res = await conn.db.insert(customers).values({
    legacyId: idKey,
    nameZh: input.nameZh,
    nameEn: input.nameEn ?? "",
    phone: input.phone ?? "",
    email: input.email ?? "",
    pointsBalance: 0,
    active: true,
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

export async function getInvoiceDetailByNo(invoiceNo: string) {
  const conn = requireSharedDb();
  const [bill] = await conn.db
    .select({
      id: bills.id,
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
      customerLegacyId: customers.legacyId,
      customerNameZh: customers.nameZh,
      customerNameEn: customers.nameEn,
      customerPhone: customers.phone,
    })
    .from(bills)
    .leftJoin(customers, eq(bills.customerId, customers.id))
    .where(eq(bills.invoiceNo, invoiceNo))
    .limit(1);

  if (!bill) return null;

  const [lines, pmts, settings] = await Promise.all([
    conn.db.select().from(billLines).where(eq(billLines.billId, bill.id)).orderBy(billLines.lineNo),
    conn.db
      .select()
      .from(billPayments)
      .where(and(eq(billPayments.billId, bill.id), eq(billPayments.voided, false)))
      .orderBy(billPayments.paidAt),
    getAppSettings(),
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
      customer: bill.customerLegacyId
        ? {
            legacyId: bill.customerLegacyId,
            nameZh: bill.customerNameZh,
            nameEn: bill.customerNameEn,
            phone: bill.customerPhone,
          }
        : null,
    },
    lines: lines.map((l) => ({
      lineNo: l.lineNo,
      sku: l.sku,
      nameZh: l.nameZh,
      nameEn: l.nameEn,
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

export async function listStockOverview(params: { q?: string; limit?: number }) {
  const conn = requireSharedDb();
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
    .leftJoin(stockBalances, eq(stockBalances.productId, products.id))
    .where(pattern ? or(like(products.barcode, pattern), like(products.nameEn, pattern), like(products.nameZh, pattern)) : undefined)
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

export async function getDayEndPreview(businessDate: string) {
  const conn = requireSharedDb();
  const [salesAgg] = await conn.db
    .select({
      billCount: sql<number>`COUNT(*)`,
      issuedTotal: sql<string>`COALESCE(SUM(${bills.netAmount}), 0)`,
      unpaidIssuedTotal: sql<string>`COALESCE(SUM(${bills.balanceDue}), 0)`,
    })
    .from(bills)
    .where(and(eq(bills.businessDate, businessDate), sql`${bills.status} <> 'cancelled'`));

  const tenderRows = await conn.db
    .select({
      tenderCode: billPayments.tenderCode,
      txCount: sql<number>`COUNT(*)`,
      collectedTotal: sql<string>`COALESCE(SUM(${billPayments.amount}), 0)`,
    })
    .from(billPayments)
    .where(and(eq(billPayments.businessDate, businessDate), eq(billPayments.voided, false)))
    .groupBy(billPayments.tenderCode);

  const recentBatches = await conn.db
    .select()
    .from(dayEndBatches)
    .orderBy(desc(dayEndBatches.businessDate), desc(dayEndBatches.batchNo))
    .limit(12);

  return {
    businessDate,
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

export async function getOperationalReports(params: { fromDate: string; toDate: string }) {
  const conn = requireSharedDb();

  const [tenderRows, categoryRows, arSummary, stockVal, recentAudits] = await Promise.all([
    conn.db
      .select({
        tenderCode: billPayments.tenderCode,
        txCount: sql<number>`COUNT(*)`,
        totalHkd: sql<string>`COALESCE(SUM(${billPayments.amount}), 0)`,
      })
      .from(billPayments)
      .where(
        and(
          eq(billPayments.voided, false),
          sql`${billPayments.businessDate} >= ${params.fromDate}`,
          sql`${billPayments.businessDate} <= ${params.toDate}`,
        ),
      )
      .groupBy(billPayments.tenderCode)
      .orderBy(desc(sql`SUM(${billPayments.amount})`)),
    conn.db
      .select({
        categoryC1: billLines.categoryC1,
        lineCount: sql<number>`COUNT(*)`,
        totalHkd: sql<string>`COALESCE(SUM(${billLines.lineTotal}), 0)`,
      })
      .from(billLines)
      .innerJoin(bills, eq(billLines.billId, bills.id))
      .where(
        and(
          eq(billLines.cancelled, false),
          sql`${billLines.legacyDk} > 0`,
          sql`${bills.status} <> 'cancelled'`,
          sql`${bills.businessDate} >= ${params.fromDate}`,
          sql`${bills.businessDate} <= ${params.toDate}`,
        ),
      )
      .groupBy(billLines.categoryC1)
      .orderBy(desc(sql`SUM(${billLines.lineTotal})`))
      .limit(15),
    conn.db
      .select({
        openInvoices: sql<number>`COUNT(*)`,
        totalBalanceDue: sql<string>`COALESCE(SUM(${bills.balanceDue}), 0)`,
      })
      .from(bills)
      .where(and(inArray(bills.paymentStatus, ["unpaid", "partial"]), sql`${bills.balanceDue} > 0`)),
    conn.db
      .select({
        skuCount: sql<number>`COUNT(*)`,
        totalQty: sql<string>`COALESCE(SUM(${stockBalances.onHandQty}), 0)`,
        totalValuation: sql<string>`COALESCE(SUM(${stockBalances.onHandQty} * ${stockBalances.movingAvgCost}), 0)`,
      })
      .from(stockBalances)
      .where(sql`${stockBalances.onHandQty} > 0`),
    conn.db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(25),
  ]);

  return {
    range: params,
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
