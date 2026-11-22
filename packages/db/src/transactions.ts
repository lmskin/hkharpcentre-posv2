import crypto from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { BillDocType, RecordPaymentInput } from "@hkharp/contracts";
import {
  calculateBillTotals,
  calculateCrmPoints,
  createIssuedInvoice,
  fromScaled4,
  roundToCents,
  settleInvoicePayment,
  toScaled4,
} from "@hkharp/domain";
import type { HarpDb } from "./client";
import { allocateNextDocumentNumber } from "./sequence";
import { auditLogs } from "./schema/org-auth";
import { products } from "./schema/catalog";
import { crmPointLedger, customers } from "./schema/crm";
import { billLines, bills, deliveryOrders, pettyCashVouchers } from "./schema/sales-ar";
import { billPayments, octopusTransactions, payMethods } from "./schema/payments";
import {
  dailyHourlySales,
  dayEndBatches,
  dayEndTenderCounts,
  stockBalances,
  stockMovements,
  stockTakeLines,
  stockTakes,
} from "./schema/stock-ops";

const OFFICE_ONLY_DOC_TYPES: BillDocType[] = [
  "GOODS_RECEIPT",
  "PURCHASE_RETURN",
  "STOCK_TRANSFER_OUT",
  "STOCK_TRANSFER_IN",
  "WRITE_OFF",
  "STOCK_ADJUSTMENT",
  "STOCKTAKE",
];
const NO_STOCK_DOC_TYPES: BillDocType[] = ["PETTY_PAYOUT", "CRM_POINT_TXN"];

export function calculateVoidStockDelta(docType: string, quantity: number, originalDelta?: number): number {
  if (docType === "STOCK_ADJUSTMENT" || docType === "STOCKTAKE") {
    if (originalDelta === undefined) throw new Error("Original stock adjustment movement is required for void");
    return -originalDelta;
  }
  const reverseSign =
    docType === "SALES_RETURN" || docType === "GOODS_RECEIPT" || docType === "STOCK_TRANSFER_IN" ? -1 : 1;
  return reverseSign * quantity;
}

export function formatHktBusinessDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function prefixForDocType(docType: BillDocType): { prefix: string; xc: number; xt: number; sd: number } {
  switch (docType) {
    case "SALES_INVOICE":
      return { prefix: "INV", xc: 23, xt: 6, sd: -1 };
    case "SALES_RETURN":
      return { prefix: "RTN", xc: 9, xt: 1, sd: 1 };
    case "PETTY_PAYOUT":
      return { prefix: "PAY", xc: 12, xt: 5, sd: 1 };
    case "GOODS_RECEIPT":
      return { prefix: "GRC", xc: 1, xt: 5, sd: 1 };
    case "PURCHASE_RETURN":
      return { prefix: "PRC", xc: 4, xt: 2, sd: -1 };
    case "STOCK_TRANSFER_OUT":
      return { prefix: "TRF", xc: 13, xt: 5, sd: -1 };
    case "STOCK_TRANSFER_IN":
      return { prefix: "TRI", xc: 14, xt: 5, sd: 1 };
    case "WRITE_OFF":
      return { prefix: "WOF", xc: 10, xt: 5, sd: -1 };
    case "STOCK_ADJUSTMENT":
      return { prefix: "ADJ", xc: 15, xt: 5, sd: 1 };
    case "STOCKTAKE":
      return { prefix: "STK", xc: 93, xt: 11, sd: 0 };
    case "CRM_POINT_TXN":
      return { prefix: "CRM", xc: 54, xt: 17, sd: 0 };
    default:
      return { prefix: "POS", xc: 99, xt: 1, sd: -1 };
  }
}

export interface CreateBillOrInvoiceTxInput {
  clientIdempotencyKey: string;
  shopId: number;
  terminalId: number;
  staffId: number;
  actorStaffId?: number;
  docType: BillDocType;
  status?: "completed" | "held";
  supersedeInvoiceNo?: string;
  createDeliveryOrder?: boolean;
  businessDateOverride?: string;
  sourceTable?: "POS_V2" | "OfficeXHeader";
  customerId?: number;
  lines: Array<{
    sku: string;
    nameZh: string;
    nameEn?: string;
    categoryC1: number;
    quantity: number;
    stockQuantity?: number;
    unitPriceHkd: number;
    discountRate?: number;
    lineDiscountAmountHkd?: number;
    excludeFromCrmBonus?: boolean;
  }>;
  initialPayments: RecordPaymentInput[];
  notes?: string;
}

export async function createBillOrInvoiceTx(db: HarpDb, input: CreateBillOrInvoiceTxInput) {
  const existing = await db
    .select()
    .from(bills)
    .where(eq(bills.clientIdempotencyKey, input.clientIdempotencyKey))
    .limit(1);

  if (existing.length > 0) {
    const b = existing[0]!;
    return {
      idempotentReplay: true,
      billId: b.id,
      invoiceNo: b.invoiceNo,
      docType: b.docType,
      status: b.status,
      paymentStatus: b.paymentStatus,
      netAmountHkd: Number(b.netAmount),
      paidAmountHkd: Number(b.paidAmount),
      balanceDueHkd: Number(b.balanceDue),
      issuedAtIso: b.issuedAt.toISOString(),
    };
  }

  const now = new Date();
  const businessDate =
    input.businessDateOverride && /^\d{4}-\d{2}-\d{2}$/.test(input.businessDateOverride)
      ? input.businessDateOverride
      : formatHktBusinessDate(now);
  const { prefix, xc, xt, sd } = prefixForDocType(input.docType);
  const invoiceNo = await allocateNextDocumentNumber(db, {
    shopId: input.shopId,
    terminalId: input.terminalId,
    docType: input.docType,
    prefix,
  });

  return db.transaction(async (tx) => {
    const closedBatch = await tx
      .select({ id: dayEndBatches.id })
      .from(dayEndBatches)
      .where(
        and(
          eq(dayEndBatches.shopId, input.shopId),
          eq(dayEndBatches.businessDate, businessDate),
          eq(dayEndBatches.closed, true),
        ),
      )
      .limit(1);
    if (closedBatch.length > 0) {
      throw new Error(`Business date ${businessDate} is sealed by day-end`);
    }

    if (input.supersedeInvoiceNo) {
      const oldRows = await tx
        .select()
        .from(bills)
        .where(eq(bills.invoiceNo, input.supersedeInvoiceNo))
        .for("update");
      if (oldRows.length === 0) {
        throw new Error(`Original bill ${input.supersedeInvoiceNo} not found for amendment`);
      }
      await voidLockedBillInsideTx(
        tx,
        oldRows[0]!,
        input.actorStaffId ?? input.staffId,
        `Superseded by ${invoiceNo}`,
      );
    }

    const totals = calculateBillTotals(
      input.lines.map((l, idx) => ({
        sku: l.sku,
        quantity: l.quantity,
        unitPriceHkd: l.unitPriceHkd,
        discountRate: l.discountRate ?? 0,
        lineDiscountAmountHkd: l.lineDiscountAmountHkd ?? 0,
        dk: idx + 1,
      })),
    );

    const isHeld = input.status === "held";
    let customerPoints = 0;
    if (input.customerId) {
      const custRows = await tx
        .select({ id: customers.id, pointsBalance: customers.pointsBalance })
        .from(customers)
        .where(eq(customers.id, input.customerId))
        .for("update");
      if (custRows.length === 0) {
        throw new Error(`Customer #${input.customerId} not found`);
      }
      customerPoints = custRows[0]!.pointsBalance;
    }

    const crm = calculateCrmPoints(
      input.lines.map((l, idx) => ({
        sku: l.sku,
        categoryC1: l.categoryC1,
        quantity: l.quantity,
        lineNetAmountHkd: totals.lines[idx]?.netHkd ?? 0,
        excludeFromCrmBonus: l.excludeFromCrmBonus,
      })),
      customerPoints,
    );

    if (!isHeld && input.customerId && !crm.redemptionAllowed) {
      throw new Error(crm.redemptionError ?? "Insufficient CRM points");
    }

    const invoiceState = createIssuedInvoice({
      invoiceNo,
      docType: input.docType,
      netAmountHkd: totals.netAmountHkd,
      issuedAtIso: now.toISOString(),
      initialPayments: isHeld
        ? []
        : input.initialPayments.map((p) => ({
            tenderCode: p.tenderCode,
            amountHkd: p.amountHkd,
            paidAtIso: p.paidAtIso ?? now.toISOString(),
            referenceNo: p.referenceNo,
          })),
    });

    if (!isHeld && OFFICE_ONLY_DOC_TYPES.includes(input.docType)) {
      invoiceState.paymentStatus = "paid";
      invoiceState.balanceDueHkd = 0;
      invoiceState.paidAtIso = now.toISOString();
    }

    const billStatus = isHeld ? ("held" as const) : ("completed" as const);
    const billInsert = await tx.insert(bills).values({
      clientIdempotencyKey: input.clientIdempotencyKey,
      shopId: input.shopId,
      terminalId: input.terminalId,
      staffId: input.staffId,
      customerId: input.customerId ?? null,
      invoiceNo,
      docType: input.docType,
      sourceTable: input.sourceTable ?? (OFFICE_ONLY_DOC_TYPES.includes(input.docType) || input.docType === "PETTY_PAYOUT" ? "OfficeXHeader" : "POS_V2"),
      legacyXc: xc,
      legacyXt: xt,
      legacySd: sd,
      status: billStatus,
      paymentStatus: invoiceState.paymentStatus,
      businessDate,
      grossAmount: totals.grossAmountHkd.toFixed(4),
      discountAmount: totals.discountAmountHkd.toFixed(4),
      netAmount: totals.netAmountHkd.toFixed(4),
      paidAmount: invoiceState.paidAmountHkd.toFixed(4),
      balanceDue: invoiceState.balanceDueHkd.toFixed(4),
      issuedAt: now,
      paidAt: !isHeld && invoiceState.paymentStatus === "paid" ? now : null,
      notes: input.notes ?? null,
    });
    const billId = Number(billInsert[0].insertId);

    const skus = Array.from(new Set(input.lines.map((l) => l.sku)));
    const prodMap = new Map<string, { id: number; avgCost: string }>();
    if (skus.length > 0) {
      const prodRows = await tx
        .select({ id: products.id, barcode: products.barcode, avgCost: products.avgCost })
        .from(products)
        .where(and(eq(products.shopId, input.shopId), inArray(products.barcode, skus)))
        .catch(async () => [] as Array<{ id: number; barcode: string; avgCost: string }>);

      const fallbackRows =
        prodRows.length > 0
          ? prodRows
          : await tx
              .select({ id: products.id, barcode: products.barcode, avgCost: products.avgCost })
              .from(products)
              .where(inArray(products.barcode, skus));

      for (const p of fallbackRows) {
        if (!prodMap.has(p.barcode)) prodMap.set(p.barcode, { id: p.id, avgCost: p.avgCost });
      }
    }

    await tx.insert(billLines).values(
      input.lines.map((l, idx) => {
        const lineCalc = totals.lines[idx]!;
        const prod = prodMap.get(l.sku);
        return {
          billId,
          lineNo: idx + 1,
          productId: prod?.id ?? null,
          sku: l.sku,
          nameZh: l.nameZh.slice(0, 200),
          nameEn: (l.nameEn ?? "").slice(0, 200),
          categoryC1: l.categoryC1,
          legacyDk: idx + 1,
          quantity: (input.docType === "STOCK_ADJUSTMENT" ? (l.stockQuantity ?? l.quantity) : l.quantity).toFixed(4),
          unitPrice: l.unitPriceHkd.toFixed(4),
          discountRate: (l.discountRate ?? 0).toFixed(6),
          lineDiscountAmount: (l.lineDiscountAmountHkd ?? 0).toFixed(4),
          lineTotal: lineCalc.netHkd.toFixed(4),
          cancelled: false,
          isModifier: false,
        };
      }),
    );

    if (isHeld) {
      await tx.insert(auditLogs).values({
        shopId: input.shopId,
        staffId: input.actorStaffId ?? input.staffId,
        action: "HOLD_BILL",
        entityType: "bills",
        entityId: invoiceNo,
        details: {
          netAmountHkd: totals.netAmountHkd,
          supersededInvoiceNo: input.supersedeInvoiceNo ?? null,
        },
      });
      return {
        idempotentReplay: false,
        billId,
        invoiceNo,
        docType: input.docType,
        status: "held" as const,
        paymentStatus: invoiceState.paymentStatus,
        netAmountHkd: totals.netAmountHkd,
        paidAmountHkd: 0,
        balanceDueHkd: totals.netAmountHkd,
        issuedAtIso: now.toISOString(),
      };
    }

    if (input.createDeliveryOrder) {
      await tx.insert(deliveryOrders).values({
        billId,
        deliveryStatus: "pending",
        remarks: input.notes ? input.notes.slice(0, 255) : null,
      });
    }

    if (input.initialPayments.length > 0) {
      const pmRows = await tx.select().from(payMethods);
      const pmIdByCode = new Map(pmRows.map((p) => [p.code, p.id]));

      for (let i = 0; i < input.initialPayments.length; i++) {
        const rawPmt = input.initialPayments[i]!;
        const applied = invoiceState.payments[i]!;
        const payMethodId = pmIdByCode.get(rawPmt.tenderCode);
        if (!payMethodId) {
          throw new Error(`Unsupported tender code: ${rawPmt.tenderCode}`);
        }

        const paidDateObj = rawPmt.paidAtIso ? new Date(rawPmt.paidAtIso) : now;
        const pmtBusinessDate = rawPmt.paidAtIso
          ? formatHktBusinessDate(paidDateObj)
          : businessDate;
        const pmtRes = await tx.insert(billPayments).values({
          billId,
          payMethodId,
          clientIdempotencyKey: `${rawPmt.clientIdempotencyKey}#${i}`,
          staffId: input.actorStaffId ?? input.staffId,
          tenderCode: rawPmt.tenderCode,
          amount: applied.amountHkd.toFixed(4),
          tipsAmount: "0.0000",
          paidAt: paidDateObj,
          businessDate: pmtBusinessDate,
          approvalCode: rawPmt.approvalCode ?? null,
          cardLast4: rawPmt.cardLast4 ?? null,
          maskedPan: rawPmt.cardLast4 ? `************${rawPmt.cardLast4}` : null,
          referenceNo: rawPmt.referenceNo ?? null,
          remarks: rawPmt.remarks ?? null,
          voided: false,
        });
        const billPaymentId = Number(pmtRes[0].insertId);

        if (rawPmt.tenderCode === "OCTOPUS" && rawPmt.octopusCardId) {
          await tx.insert(octopusTransactions).values({
            billId,
            billPaymentId,
            shopId: input.shopId,
            terminalId: input.terminalId,
            requestId: `${input.clientIdempotencyKey}-octo-${i}`,
            cardId: rawPmt.octopusCardId,
            deviceId: rawPmt.octopusDeviceId ?? "RWL-01",
            amountCents: Math.round(applied.amountHkd * 100),
            remainingValueCents:
              rawPmt.octopusRemainingHkd !== undefined ? Math.round(rawPmt.octopusRemainingHkd * 100) : null,
            resultCode: 0,
            incomplete100022Recovered: false,
            transactedAt: paidDateObj,
          });
        }
      }
    }

    if (input.docType === "PETTY_PAYOUT") {
      await tx.insert(pettyCashVouchers).values({
        shopId: input.shopId,
        billId,
        amount: totals.netAmountHkd.toFixed(4),
        reason: (input.notes || "POS Petty Cash Payout").slice(0, 255),
      });
    }

    if (input.customerId && crm.netPointDelta !== 0) {
      await tx.insert(crmPointLedger).values({
        customerId: input.customerId,
        billId,
        ruleRid: crm.redeemedPoints > 0 ? 3 : 1,
        deltaPoints: crm.netPointDelta,
        reason: `Bill ${invoiceNo} (earn +${crm.earnedPoints}, redeem -${crm.redeemedPoints})`,
      });
      await tx
        .update(customers)
        .set({ pointsBalance: sql`${customers.pointsBalance} + ${crm.netPointDelta}` })
        .where(eq(customers.id, input.customerId));
    }

    if (!NO_STOCK_DOC_TYPES.includes(input.docType)) {
      for (const l of input.lines) {
        const prod = prodMap.get(l.sku);
        if (!prod) continue;
        let sign = -1;
        let moveType = "SALE";
        if (input.docType === "SALES_RETURN") { sign = 1; moveType = "RETURN"; }
        else if (input.docType === "GOODS_RECEIPT") { sign = 1; moveType = "PURCHASE_IN"; }
        else if (input.docType === "PURCHASE_RETURN") { sign = -1; moveType = "PURCHASE_RETURN"; }
        else if (input.docType === "STOCK_TRANSFER_OUT") { sign = -1; moveType = "TRANSFER_OUT"; }
        else if (input.docType === "STOCK_TRANSFER_IN") { sign = 1; moveType = "TRANSFER_IN"; }
        else if (input.docType === "WRITE_OFF") { sign = -1; moveType = "WRITE_OFF"; }
        else if (input.docType === "STOCK_ADJUSTMENT") { sign = 1; moveType = "ADJUST"; }
        else if (input.docType === "STOCKTAKE") { sign = 1; moveType = "STOCKTAKE"; }

        const stockQuantity = l.stockQuantity ?? l.quantity;
        const delta = sign * stockQuantity;
        const balRows = await tx
          .select()
          .from(stockBalances)
          .where(and(eq(stockBalances.shopId, input.shopId), eq(stockBalances.productId, prod.id)))
          .for("update");

        const currentQty = Number(balRows[0]?.onHandQty ?? 0);
        const currentCost = Number(balRows[0]?.movingAvgCost ?? prod.avgCost ?? 0);
        const nextQty = currentQty + delta;
        let nextCost = currentCost;
        if (input.docType === "GOODS_RECEIPT" && nextQty > 0) {
          nextCost = roundToCents((Math.max(0, currentQty) * currentCost + stockQuantity * l.unitPriceHkd) / nextQty);
        }
        const deltaText = delta.toFixed(4);
        const nextCostText = nextCost.toFixed(4);
        if (balRows.length === 0) {
          await tx.insert(stockBalances).values({
            shopId: input.shopId,
            productId: prod.id,
            onHandQty: nextQty.toFixed(4),
            movingAvgCost: nextCostText,
          });
        } else {
          await tx
            .update(stockBalances)
            .set({ onHandQty: nextQty.toFixed(4), movingAvgCost: nextCostText, updatedAt: now })
            .where(eq(stockBalances.id, balRows[0]!.id));
        }
        if (input.docType === "GOODS_RECEIPT") {
          await tx.update(products).set({ lastPurchaseCost: l.unitPriceHkd.toFixed(4), avgCost: nextCostText }).where(eq(products.id, prod.id));
        }
        await tx.insert(stockMovements).values({
          shopId: input.shopId,
          productId: prod.id,
          billId,
          movementType: moveType,
          legacyXc: xc,
          onHandDelta: deltaText,
          unitCost: currentCost.toFixed(4),
          movingAvgCostAfter: nextCostText,
        });
      }
    }

    await tx.insert(auditLogs).values({
      shopId: input.shopId,
      staffId: input.actorStaffId ?? input.staffId,
      action: input.docType === "SALES_INVOICE" ? "ISSUE_INVOICE" : "CREATE_BILL",
      entityType: "bills",
      entityId: invoiceNo,
      details: {
        paymentStatus: invoiceState.paymentStatus,
        netAmountHkd: totals.netAmountHkd,
        paidAmountHkd: invoiceState.paidAmountHkd,
        balanceDueHkd: invoiceState.balanceDueHkd,
        supersededInvoiceNo: input.supersedeInvoiceNo ?? null,
      },
    });

    return {
      idempotentReplay: false,
      billId,
      invoiceNo,
      docType: input.docType,
      status: "completed" as const,
      paymentStatus: invoiceState.paymentStatus,
      netAmountHkd: totals.netAmountHkd,
      paidAmountHkd: invoiceState.paidAmountHkd,
      balanceDueHkd: invoiceState.balanceDueHkd,
      issuedAtIso: now.toISOString(),
    };
  });
}

export async function settleInvoiceArTx(
  db: HarpDb,
  input: {
    invoiceNo: string;
    staffId: number;
    payment: RecordPaymentInput;
  },
) {
  const existingPmt = await db
    .select()
    .from(billPayments)
    .where(eq(billPayments.clientIdempotencyKey, input.payment.clientIdempotencyKey))
    .limit(1);

  if (existingPmt.length > 0) {
    const [b] = await db.select().from(bills).where(eq(bills.id, existingPmt[0]!.billId)).limit(1);
    return {
      idempotentReplay: true,
      invoiceNo: b?.invoiceNo ?? input.invoiceNo,
      paymentStatus: b?.paymentStatus ?? "paid",
      paidAmountHkd: Number(b?.paidAmount ?? 0),
      balanceDueHkd: Number(b?.balanceDue ?? 0),
    };
  }

  return db.transaction(async (tx) => {
    const lockedBills = await tx
      .select()
      .from(bills)
      .where(eq(bills.invoiceNo, input.invoiceNo))
      .for("update");

    if (lockedBills.length === 0) {
      throw new Error(`Invoice ${input.invoiceNo} not found`);
    }
    const row = lockedBills[0]!;

    const paidDate = input.payment.paidAtIso ? new Date(input.payment.paidAtIso) : new Date();
    const updatedState = settleInvoicePayment(
      {
        invoiceNo: row.invoiceNo,
        docType: row.docType as BillDocType,
        status: row.status as "completed" | "open" | "held" | "intraday" | "sealed" | "cancelled",
        paymentStatus: row.paymentStatus as "unpaid" | "partial" | "paid" | "voided",
        netAmountHkd: Number(row.netAmount),
        paidAmountHkd: Number(row.paidAmount),
        balanceDueHkd: Number(row.balanceDue),
        issuedAtIso: row.issuedAt.toISOString(),
        paidAtIso: row.paidAt?.toISOString(),
        payments: [],
      },
      {
        tenderCode: input.payment.tenderCode,
        amountHkd: input.payment.amountHkd,
        paidAtIso: paidDate.toISOString(),
        referenceNo: input.payment.referenceNo,
      },
    );

    const [pmRow] = await tx
      .select()
      .from(payMethods)
      .where(eq(payMethods.code, input.payment.tenderCode))
      .limit(1);

    if (!pmRow) {
      throw new Error(`Unsupported tender code ${input.payment.tenderCode}`);
    }

    const appliedAmt = updatedState.payments[0]!.amountHkd;
    await tx.insert(billPayments).values({
      billId: row.id,
      payMethodId: pmRow.id,
      clientIdempotencyKey: input.payment.clientIdempotencyKey,
      staffId: input.staffId,
      tenderCode: input.payment.tenderCode,
      amount: appliedAmt.toFixed(4),
      tipsAmount: "0.0000",
      paidAt: paidDate,
      businessDate: formatHktBusinessDate(paidDate),
      approvalCode: input.payment.approvalCode ?? null,
      cardLast4: input.payment.cardLast4 ?? null,
      maskedPan: input.payment.cardLast4 ? `************${input.payment.cardLast4}` : null,
      referenceNo: input.payment.referenceNo ?? null,
      remarks: input.payment.remarks ?? null,
      voided: false,
    });

    await tx
      .update(bills)
      .set({
        paymentStatus: updatedState.paymentStatus,
        paidAmount: updatedState.paidAmountHkd.toFixed(4),
        balanceDue: updatedState.balanceDueHkd.toFixed(4),
        paidAt: updatedState.paymentStatus === "paid" ? paidDate : row.paidAt,
      })
      .where(eq(bills.id, row.id));

    await tx.insert(auditLogs).values({
      shopId: row.shopId,
      staffId: input.staffId,
      action: "SETTLE_INVOICE_AR",
      entityType: "bills",
      entityId: row.invoiceNo,
      details: {
        tenderCode: input.payment.tenderCode,
        appliedAmountHkd: appliedAmt,
        newPaymentStatus: updatedState.paymentStatus,
        newBalanceDueHkd: updatedState.balanceDueHkd,
        referenceNo: input.payment.referenceNo ?? null,
      },
    });

    return {
      idempotentReplay: false,
      invoiceNo: row.invoiceNo,
      paymentStatus: updatedState.paymentStatus,
      paidAmountHkd: updatedState.paidAmountHkd,
      balanceDueHkd: updatedState.balanceDueHkd,
      paidAtIso: updatedState.paidAtIso,
    };
  });
}

type DbTransaction = Parameters<Parameters<HarpDb["transaction"]>[0]>[0];

async function voidLockedBillInsideTx(
  tx: DbTransaction,
  bill: typeof bills.$inferSelect,
  staffId: number,
  reason: string,
  authorizedByStaffId?: number,
) {
  if (bill.status === "sealed") {
    throw new Error(`Bill ${bill.invoiceNo} is sealed by day-end`);
  }
  if (bill.status === "cancelled") {
    throw new Error(`Bill ${bill.invoiceNo} is already voided`);
  }
  const closedBatch = await tx
    .select({ id: dayEndBatches.id })
    .from(dayEndBatches)
    .where(
      and(
        eq(dayEndBatches.shopId, bill.shopId),
        eq(dayEndBatches.businessDate, bill.businessDate),
        eq(dayEndBatches.closed, true),
      ),
    )
    .limit(1);
  if (closedBatch.length > 0) {
    throw new Error(`Business date ${bill.businessDate} is sealed by day-end`);
  }

  const wasHeld = bill.status === "held";
  await tx
    .update(bills)
    .set({ status: "cancelled", paymentStatus: "voided", balanceDue: "0.0000" })
    .where(eq(bills.id, bill.id));

  if (!wasHeld) {
    await tx.update(billPayments).set({ voided: true }).where(eq(billPayments.billId, bill.id));

    const lines = await tx.select().from(billLines).where(eq(billLines.billId, bill.id));
    if (!NO_STOCK_DOC_TYPES.includes(bill.docType as BillDocType)) {
      const originalMovements =
        bill.docType === "STOCK_ADJUSTMENT" || bill.docType === "STOCKTAKE"
          ? await tx.select().from(stockMovements).where(eq(stockMovements.billId, bill.id))
          : [];
      for (const l of lines) {
        if (!l.productId || l.cancelled) continue;
        const originalDelta = originalMovements.find((movement) => movement.productId === l.productId)?.onHandDelta;
        const delta = calculateVoidStockDelta(
          bill.docType,
          Number(l.quantity),
          originalDelta === undefined ? undefined : Number(originalDelta),
        ).toFixed(4);
        await tx
          .update(stockBalances)
          .set({ onHandQty: sql`${stockBalances.onHandQty} + ${delta}` })
          .where(and(eq(stockBalances.shopId, bill.shopId), eq(stockBalances.productId, l.productId)));

        await tx.insert(stockMovements).values({
          shopId: bill.shopId,
          productId: l.productId,
          billId: bill.id,
          movementType: "VOID_REVERSAL",
          onHandDelta: delta,
          unitCost: l.unitPrice,
          movingAvgCostAfter: l.unitPrice,
        });
      }
    }

    if (bill.customerId) {
      const ledgerEntries = await tx
        .select()
        .from(crmPointLedger)
        .where(eq(crmPointLedger.billId, bill.id));
      const netDelta = ledgerEntries.reduce((acc, r) => acc + r.deltaPoints, 0);
      if (netDelta !== 0) {
        await tx.insert(crmPointLedger).values({
          customerId: bill.customerId,
          billId: bill.id,
          deltaPoints: -netDelta,
          reason: `Void reversal for ${bill.invoiceNo}`,
        });
        await tx
          .update(customers)
          .set({ pointsBalance: sql`${customers.pointsBalance} - ${netDelta}` })
          .where(eq(customers.id, bill.customerId));
      }
    }
  }

  await tx.insert(auditLogs).values({
    shopId: bill.shopId,
    staffId,
    action: "VOID_BILL",
    entityType: "bills",
    entityId: bill.invoiceNo,
    details: { reason, wasHeld, authorizedByStaffId: authorizedByStaffId ?? null },
  });

  return { ok: true, invoiceNo: bill.invoiceNo, status: "cancelled" as const };
}

export async function voidBillTx(
  db: HarpDb,
  input: { invoiceNo: string; staffId: number; reason: string; authorizedByStaffId?: number },
) {
  return db.transaction(async (tx) => {
    const locked = await tx.select().from(bills).where(eq(bills.invoiceNo, input.invoiceNo)).for("update");
    if (locked.length === 0) throw new Error(`Bill ${input.invoiceNo} not found`);
    return voidLockedBillInsideTx(tx, locked[0]!, input.staffId, input.reason, input.authorizedByStaffId);
  });
}

export type StockOperationType = "PURCHASE_IN" | "ADJUST" | "WRITE_OFF" | "STOCKTAKE";

export async function recordStockOperationTx(
  db: HarpDb,
  input: {
    shopId: number;
    staffId: number;
    operationType: StockOperationType;
    lines: Array<{ productId: number; quantityOrCount: number; unitCostHkd?: number }>;
    remarks?: string;
  },
) {
  return db.transaction(async (tx) => {
    let stockTakeId: number | null = null;
    if (input.operationType === "STOCKTAKE") {
      const stRes = await tx.insert(stockTakes).values({
        shopId: input.shopId,
        staffId: input.staffId,
        status: "completed",
      });
      stockTakeId = Number(stRes[0].insertId);
    }

    const updatedProducts: Array<{ productId: number; newOnHand: number; newAvgCost: number }> = [];
    for (const line of input.lines) {
      const balRows = await tx
        .select()
        .from(stockBalances)
        .where(and(eq(stockBalances.shopId, input.shopId), eq(stockBalances.productId, line.productId)))
        .for("update");

      const currentQty = Number(balRows[0]?.onHandQty ?? 0);
      const currentCost = Number(balRows[0]?.movingAvgCost ?? 0);

      let deltaQty = line.quantityOrCount;
      let nextQty = currentQty;
      let nextCost = currentCost;
      const moveUnitCost = line.unitCostHkd ?? currentCost;
      let xc = 15;

      if (input.operationType === "PURCHASE_IN") {
        xc = 1;
        deltaQty = Math.abs(line.quantityOrCount);
        nextQty = currentQty + deltaQty;
        if (nextQty > 0 && line.unitCostHkd !== undefined) {
          const totalValue = Math.max(0, currentQty) * currentCost + deltaQty * line.unitCostHkd;
          nextCost = roundToCents(fromScaled4(toScaled4(totalValue / (Math.max(0, currentQty) + deltaQty))));
        }
      } else if (input.operationType === "WRITE_OFF") {
        xc = 10;
        deltaQty = -Math.abs(line.quantityOrCount);
        nextQty = currentQty + deltaQty;
      } else if (input.operationType === "ADJUST") {
        xc = 15;
        nextQty = currentQty + deltaQty;
      } else if (input.operationType === "STOCKTAKE") {
        xc = 93;
        deltaQty = line.quantityOrCount - currentQty;
        nextQty = line.quantityOrCount;
        await tx.insert(stockTakeLines).values({
          stockTakeId: stockTakeId!,
          productId: line.productId,
          expectedQty: currentQty.toFixed(4),
          countedQty: line.quantityOrCount.toFixed(4),
        });
      }

      if (balRows.length === 0) {
        await tx.insert(stockBalances).values({
          shopId: input.shopId,
          productId: line.productId,
          onHandQty: nextQty.toFixed(4),
          movingAvgCost: nextCost.toFixed(4),
        });
      } else {
        await tx
          .update(stockBalances)
          .set({ onHandQty: nextQty.toFixed(4), movingAvgCost: nextCost.toFixed(4), updatedAt: new Date() })
          .where(eq(stockBalances.id, balRows[0]!.id));
      }

      if (input.operationType === "PURCHASE_IN" && line.unitCostHkd !== undefined) {
        await tx
          .update(products)
          .set({ lastPurchaseCost: line.unitCostHkd.toFixed(4), avgCost: nextCost.toFixed(4) })
          .where(eq(products.id, line.productId));
      }

      await tx.insert(stockMovements).values({
        shopId: input.shopId,
        productId: line.productId,
        movementType: input.operationType,
        legacyXc: xc,
        onHandDelta: deltaQty.toFixed(4),
        unitCost: moveUnitCost.toFixed(4),
        movingAvgCostAfter: nextCost.toFixed(4),
      });

      updatedProducts.push({ productId: line.productId, newOnHand: nextQty, newAvgCost: nextCost });
    }

    await tx.insert(auditLogs).values({
      shopId: input.shopId,
      staffId: input.staffId,
      action: `STOCK_${input.operationType}`,
      entityType: "stock_balances",
      entityId: String(input.shopId),
      details: { remarks: input.remarks ?? null, updatedProducts },
    });

    return { ok: true, operationType: input.operationType, updatedProducts };
  });
}

export async function closeDayEndBatchTx(
  db: HarpDb,
  input: {
    shopId: number;
    terminalId: number;
    staffId: number;
    businessDate: string;
    countedByTender: Array<{ tenderCode: string; countedAmountHkd: number }>;
    authorizedByStaffId?: number;
  },
) {
  return db.transaction(async (tx) => {
    const [salesAgg] = await tx
      .select({
        totalNet: sql<string>`COALESCE(SUM(CASE WHEN ${bills.docType} = 'SALES_RETURN' THEN -${bills.netAmount} ELSE ${bills.netAmount} END), 0)`,
      })
      .from(bills)
      .where(
        and(
          eq(bills.shopId, input.shopId),
          eq(bills.businessDate, input.businessDate),
          sql`${bills.status} <> 'cancelled'`,
          inArray(bills.docType, ["RETAIL_SALE", "SALES_INVOICE", "SALES_RETURN"]),
        ),
      );

    const pmtGroups = await tx
      .select({
        tenderCode: billPayments.tenderCode,
        totalCollected: sql<string>`COALESCE(SUM(CASE WHEN ${bills.docType} IN ('SALES_RETURN', 'PETTY_PAYOUT') THEN -${billPayments.amount} ELSE ${billPayments.amount} END), 0)`,
      })
      .from(billPayments)
      .innerJoin(bills, eq(billPayments.billId, bills.id))
      .where(
        and(
          eq(bills.shopId, input.shopId),
          eq(billPayments.businessDate, input.businessDate),
          eq(billPayments.voided, false),
          sql`${bills.status} <> 'cancelled'`,
        ),
      )
      .groupBy(billPayments.tenderCode);

    const expectedMap = new Map(pmtGroups.map((p) => [p.tenderCode, Number(p.totalCollected)]));
    const issuedSalesTotal = Number(salesAgg?.totalNet ?? 0);
    const collectedPaymentsTotal = Array.from(expectedMap.values()).reduce((s, v) => s + v, 0);

    const existingBatches = await tx
      .select()
      .from(dayEndBatches)
      .where(
        and(
          eq(dayEndBatches.shopId, input.shopId),
          eq(dayEndBatches.terminalId, input.terminalId),
          eq(dayEndBatches.businessDate, input.businessDate),
        ),
      );

    if (existingBatches.some((batch) => batch.closed)) {
      throw new Error(`Business date ${input.businessDate} is already sealed`);
    }
    const batchNo = existingBatches.length + 1;
    const legacyBk = `V2-${input.businessDate.replace(/-/g, "")}-${batchNo}-${crypto.randomInt(100, 999)}`;
    const res = await tx.insert(dayEndBatches).values({
      legacyBk,
      shopId: input.shopId,
      terminalId: input.terminalId,
      businessDate: input.businessDate,
      batchNo,
      status: "closed",
      issuedSalesTotal: issuedSalesTotal.toFixed(4),
      collectedPaymentsTotal: collectedPaymentsTotal.toFixed(4),
      closed: true,
      closedAt: new Date(),
    });
    const batchId = Number(res[0].insertId);

    const allTenders = new Set<string>([
      ...expectedMap.keys(),
      ...input.countedByTender.map((c) => c.tenderCode),
    ]);
    const countedMap = new Map(input.countedByTender.map((c) => [c.tenderCode, c.countedAmountHkd]));

    if (allTenders.size > 0) {
      await tx.insert(dayEndTenderCounts).values(
        Array.from(allTenders).map((code) => {
          const expected = expectedMap.get(code) ?? 0;
          const counted = countedMap.get(code) ?? expected;
          return {
            batchId,
            tenderCode: code,
            expectedCollectedAmount: expected.toFixed(4),
            countedAmount: counted.toFixed(4),
            varianceAmount: (counted - expected).toFixed(4),
          };
        }),
      );
    }

    const hourlyRows = await tx
      .select({
        hourOfDay: sql<number>`HOUR(${bills.issuedAt})`,
        cnt: sql<number>`COUNT(*)`,
        sumNet: sql<string>`COALESCE(SUM(${bills.netAmount}), 0)`,
      })
      .from(bills)
      .where(
        and(
          eq(bills.shopId, input.shopId),
          eq(bills.businessDate, input.businessDate),
          sql`${bills.status} <> 'cancelled'`,
        ),
      )
      .groupBy(sql`HOUR(${bills.issuedAt})`);

    for (const h of hourlyRows) {
      await tx
        .insert(dailyHourlySales)
        .values({
          shopId: input.shopId,
          businessDate: input.businessDate,
          hourOfDay: Number(h.hourOfDay),
          billCount: Number(h.cnt),
          netSalesAmount: Number(h.sumNet).toFixed(4),
        })
        .onDuplicateKeyUpdate({
          set: {
            billCount: Number(h.cnt),
            netSalesAmount: Number(h.sumNet).toFixed(4),
          },
        });
    }

    await tx
      .update(bills)
      .set({ status: "sealed" })
      .where(
        and(
          eq(bills.shopId, input.shopId),
          eq(bills.businessDate, input.businessDate),
          eq(bills.status, "completed"),
        ),
      );

    await tx.insert(auditLogs).values({
      shopId: input.shopId,
      staffId: input.staffId,
      action: "CLOSE_DAY_END",
      entityType: "day_end_batches",
      entityId: String(batchId),
      details: {
        businessDate: input.businessDate,
        batchNo,
        issuedSalesTotal,
        collectedPaymentsTotal,
        authorizedByStaffId: input.authorizedByStaffId ?? null,
      },
    });

    return {
      ok: true,
      batchId,
      batchNo,
      businessDate: input.businessDate,
      issuedSalesTotal,
      collectedPaymentsTotal,
    };
  });
}
