import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auditLogs, bills, deliveryOrders, requireSharedDb } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

export async function POST(
  request: Request,
  context: { params: Promise<{ invoiceNo: string }> },
) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) as {
    action?: "receive" | "reject" | "problem";
    remarks?: string;
  };
  const action = body?.action ?? "receive";
  const nextStatus =
    action === "reject" ? "rejected" : action === "problem" ? "problem" : "delivered";
  const auditAction =
    action === "reject"
      ? "REJECT_DELIVERY"
      : action === "problem"
        ? "PROBLEM_DELIVERY"
        : "COMPLETE_DELIVERY";
  const cleanRemarks = body?.remarks?.trim() || undefined;

  const { invoiceNo: rawInvoiceNo } = await context.params;
  const invoiceNo = decodeURIComponent(rawInvoiceNo);
  const { db } = requireSharedDb();
  const [bill] = await db.select().from(bills).where(eq(bills.invoiceNo, invoiceNo)).limit(1);
  if (!bill) return NextResponse.json({ error: "單據不存在" }, { status: 404 });
  if (bill.status === "cancelled") {
    return NextResponse.json({ error: "已取消單據不能處理送貨狀態" }, { status: 422 });
  }

  await db.transaction(async (tx) => {
    const existing = await tx.select().from(deliveryOrders).where(eq(deliveryOrders.billId, bill.id)).limit(1);
    if (existing[0]) {
      await tx
        .update(deliveryOrders)
        .set({
          deliveryStatus: nextStatus,
          ...(cleanRemarks !== undefined ? { remarks: cleanRemarks } : {}),
        })
        .where(eq(deliveryOrders.id, existing[0].id));
    } else {
      await tx.insert(deliveryOrders).values({
        billId: bill.id,
        deliveryStatus: nextStatus,
        remarks: cleanRemarks ?? null,
      });
    }
    await tx.insert(auditLogs).values({
      shopId: bill.shopId,
      staffId: auth.session.staffId,
      action: auditAction,
      entityType: "bills",
      entityId: invoiceNo,
      details: { invoiceNo, deliveryStatus: nextStatus, remarks: cleanRemarks ?? null },
    });
  });

  const [delivery] = await db
    .select()
    .from(deliveryOrders)
    .where(and(eq(deliveryOrders.billId, bill.id), eq(deliveryOrders.deliveryStatus, nextStatus)))
    .limit(1);
  return NextResponse.json({ ok: true, invoiceNo, deliveryStatus: delivery?.deliveryStatus ?? nextStatus });
}
