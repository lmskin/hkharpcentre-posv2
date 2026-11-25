import { NextResponse } from "next/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { auditLogs, bills, deliveryOrders, requireSharedDb } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

export async function POST(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as { invoiceNos?: string[] };
  const invoiceNos = Array.isArray(body?.invoiceNos)
    ? body.invoiceNos.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];

  const { db } = requireSharedDb();
  const updatedCount = await db.transaction(async (tx) => {
    const filters = [
      eq(bills.shopId, auth.session.shopId),
      ne(bills.status, "cancelled"),
      eq(deliveryOrders.deliveryStatus, "pending"),
    ];
    if (invoiceNos.length > 0) {
      filters.push(inArray(bills.invoiceNo, invoiceNos));
    }
    const pendingRows = await tx
      .select({ id: deliveryOrders.id, invoiceNo: bills.invoiceNo })
      .from(deliveryOrders)
      .innerJoin(bills, eq(bills.id, deliveryOrders.billId))
      .where(and(...filters));

    if (pendingRows.length === 0) return 0;

    await tx
      .update(deliveryOrders)
      .set({ deliveryStatus: "delivered" })
      .where(
        inArray(
          deliveryOrders.id,
          pendingRows.map((r) => r.id),
        ),
      );

    await tx.insert(auditLogs).values({
      shopId: auth.session.shopId,
      staffId: auth.session.staffId,
      action: "RECEIVE_ALL_DELIVERIES",
      entityType: "delivery_orders",
      entityId: String(pendingRows.length),
      details: { invoiceNos: pendingRows.map((r) => r.invoiceNo) },
    });

    return pendingRows.length;
  });

  return NextResponse.json({ ok: true, updatedCount });
}
