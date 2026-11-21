import { NextResponse } from "next/server";
import { z } from "zod";
import { listStockOverview, recordStockOperationTx, requireSharedDb } from "@hkharp/db";
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
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? undefined;
  const items = await listStockOverview({ q, limit: 80 });
  return NextResponse.json({ items });
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
  const res = await recordStockOperationTx(db, {
    shopId: auth.session.shopId || 1,
    staffId: auth.session.staffId,
    operationType: parsed.data.operationType,
    lines: parsed.data.lines,
    remarks: parsed.data.remarks,
  });
  return NextResponse.json(res, { status: 201 });
}
