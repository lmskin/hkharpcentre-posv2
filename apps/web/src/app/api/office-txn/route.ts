import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { calculateBillTotals } from "@hkharp/domain/bill-math";
import { createBillOrInvoiceTx, products, requireSharedDb, resolveActiveStoreContext } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const OfficeTxnSchema = z.object({
  clientIdempotencyKey: z.string().min(8).max(64),
  docType: z.enum([
    "GOODS_RECEIPT",
    "PURCHASE_RETURN",
    "STOCK_TRANSFER_OUT",
    "STOCK_TRANSFER_IN",
    "WRITE_OFF",
    "STOCK_ADJUSTMENT",
    "STOCKTAKE",
    "SALES_RETURN",
    "PETTY_PAYOUT",
  ]),
  businessDateOverride: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  supplierLegacyId: z.string().trim().max(32).optional(),
  reference: z.string().trim().max(180).default(""),
  notes: z.string().trim().max(300).default(""),
  lines: z.array(z.object({
    sku: z.string().trim().min(1).max(40),
    nameZh: z.string().trim().min(1).max(200),
    nameEn: z.string().max(200).default(""),
    categoryC1: z.number().int().min(0).max(999).default(0),
    quantity: z.number().positive(),
    unitPriceHkd: z.number().nonnegative(),
    adjustmentDirection: z.union([z.literal(1), z.literal(-1)]).default(1),
  })).min(1).max(130),
});

export async function POST(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = OfficeTxnSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "其他交易資料格式錯誤", issues: parsed.error.issues }, { status: 400 });
  const input = parsed.data;

  try {
    const { db } = requireSharedDb();
    const storeCtx = await resolveActiveStoreContext();
    if (input.docType !== "PETTY_PAYOUT") {
      const skus = Array.from(new Set(input.lines.map((line) => line.sku)));
      const rows = await db.select({ barcode: products.barcode }).from(products).where(inArray(products.barcode, skus));
      const found = new Set(rows.map((row) => row.barcode));
      const missing = skus.filter((sku) => !found.has(sku));
      if (missing.length > 0) return NextResponse.json({ error: `貨品不存在：${missing.join(", ")}` }, { status: 422 });
    }

    const totals = calculateBillTotals(input.lines.map((line, index) => ({
      sku: line.sku,
      quantity: line.quantity,
      unitPriceHkd: line.unitPriceHkd,
      discountRate: 0,
      lineDiscountAmountHkd: 0,
      dk: index + 1,
    })));
    if ((input.docType === "SALES_RETURN" || input.docType === "PETTY_PAYOUT") && totals.netAmountHkd <= 0) {
      return NextResponse.json({ error: "退貨或 Payout 總金額必須大於零" }, { status: 422 });
    }
    const initialPayments = input.docType === "SALES_RETURN" || input.docType === "PETTY_PAYOUT"
      ? [{ clientIdempotencyKey: `${input.clientIdempotencyKey}-pmt`.slice(0, 64), tenderCode: "CASH" as const, amountHkd: totals.netAmountHkd, remarks: input.docType }]
      : [];
    const result = await createBillOrInvoiceTx(db, {
      clientIdempotencyKey: input.clientIdempotencyKey,
      shopId: auth.session.shopId || storeCtx.shopId,
      terminalId: storeCtx.terminalId,
      staffId: auth.session.staffId,
      docType: input.docType,
      businessDateOverride: input.businessDateOverride,
      sourceTable: "OfficeXHeader",
      legacySc: input.supplierLegacyId || null,
      lines: input.lines.map((line) => ({
        ...line,
        stockQuantity: input.docType === "STOCK_ADJUSTMENT" ? line.quantity * line.adjustmentDirection : line.quantity,
        discountRate: 0,
        lineDiscountAmountHkd: 0,
        excludeFromCrmBonus: true,
      })),
      initialPayments,
      notes: [input.reference, input.notes].filter(Boolean).join(" · ").slice(0, 500),
    });
    return NextResponse.json(result, { status: result.idempotentReplay ? 200 : 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "其他交易儲存失敗" }, { status: 422 });
  }
}
