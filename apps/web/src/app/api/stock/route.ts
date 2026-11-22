import { NextResponse } from "next/server";
import { z } from "zod";
import {
  listStockMovements,
  listStockPage,
  recordStockOperationTx,
  requireSharedDb,
  resolveActiveStoreContext,
} from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const StockOpSchema = z.object({
  operationType: z.enum(["PURCHASE_IN", "ADJUST", "WRITE_OFF", "STOCKTAKE"]),
  remarks: z.string().trim().max(200).optional(),
  lines: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantityOrCount: z.number(),
        unitCostHkd: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
});

export async function GET(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const storeCtx = await resolveActiveStoreContext();
  const shopId = auth.session.shopId || storeCtx.shopId;
  const url = new URL(request.url);
  const productIdRaw = url.searchParams.get("productId");
  if (productIdRaw) {
    const productId = Number(productIdRaw);
    if (!Number.isInteger(productId) || productId <= 0) {
      return NextResponse.json({ error: "Invalid productId" }, { status: 400 });
    }
    const movements = await listStockMovements(productId, shopId);
    return NextResponse.json({ movements });
  }

  const q = url.searchParams.get("q") ?? undefined;
  const c1Raw = url.searchParams.get("categoryC1");
  const categoryC1 = c1Raw !== null && c1Raw !== "" ? Number(c1Raw) : undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") ?? "80") || 80));
  const result = await listStockPage({ q, categoryC1, page, pageSize, shopId });
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedSession(4);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const raw = await request.json().catch(() => null);
  const parsed = StockOpSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid stock operation", issues: parsed.error.issues }, { status: 400 });
  }

  const { db } = requireSharedDb();
  const storeCtx = await resolveActiveStoreContext();
  const res = await recordStockOperationTx(db, {
    shopId: auth.session.shopId || storeCtx.shopId,
    staffId: auth.session.staffId,
    operationType: parsed.data.operationType,
    lines: parsed.data.lines,
    remarks: parsed.data.remarks,
  });
  return NextResponse.json(res, { status: 201 });
}
