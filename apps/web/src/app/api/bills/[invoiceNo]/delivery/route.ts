import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auditLogs, bills, deliveryOrders, requireSharedDb } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

export async function POST(
  _request: Request,
  context: { params: Promise<{ invoiceNo: string }> },
) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { invoiceNo: rawInvoiceNo } = await context.params;
  const invoiceNo = decodeURIComponent(rawInvoiceNo);
  const { db } = requireSharedDb();
  const [bill] = await db.select().from(bills).where(eq(bills.invoiceNo, invoiceNo)).limit(1);
  if (!bill) return NextResponse.json({ error: "單據不存在" }, { status: 404 });
  if (bill.status === "cancelled") {
    return NextResponse.json({ error: "已取消單據不能提貨" }, { status: 422 });
  }

  await db.transaction(async (tx) => {
    const existing = await tx.select().from(deliveryOrders).where(eq(deliveryOrders.billId, bill.id)).limit(1);
    if (existing[0]) {
      await tx.update(deliveryOrders).set({ deliveryStatus: "delivered" }).where(eq(deliveryOrders.id, existing[0].id));
    } else {
      await tx.insert(deliveryOrders).values({ billId: bill.id, deliveryStatus: "delivered" });
    }
    await tx.insert(auditLogs).values({
      shopId: bill.shopId,
      staffId: auth.session.staffId,
      action: "COMPLETE_DELIVERY",
      entityType: "bills",
      entityId: invoiceNo,
      details: { invoiceNo },
    });
  });

  const [delivery] = await db
    .select()
    .from(deliveryOrders)
    .where(and(eq(deliveryOrders.billId, bill.id), eq(deliveryOrders.deliveryStatus, "delivered")))
    .limit(1);
  return NextResponse.json({ ok: true, invoiceNo, deliveryStatus: delivery?.deliveryStatus ?? "delivered" });
}
