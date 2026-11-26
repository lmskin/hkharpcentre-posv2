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
    action?: "receive" | "reject" | "problem" | "update_info" | "reset_pending";
    scheduledDate?: string;
    recipientPhone?: string;
    deliveryAddress?: string;
    remarks?: string;
  };
  const action = body?.action ?? "receive";
  const nextStatus =
    action === "reject"
      ? "rejected"
      : action === "problem"
        ? "problem"
        : action === "reset_pending"
          ? "pending"
          : action === "update_info"
            ? undefined
            : "delivered";
  const auditAction =
    action === "reject"
      ? "REJECT_DELIVERY"
      : action === "problem"
        ? "PROBLEM_DELIVERY"
        : action === "reset_pending"
          ? "RESET_DELIVERY_PENDING"
          : action === "update_info"
            ? "UPDATE_DELIVERY_INFO"
            : "COMPLETE_DELIVERY";
  const cleanRemarks = body?.remarks !== undefined ? body.remarks.trim() : undefined;
  const parsedDate =
    body?.scheduledDate && /^\d{4}-\d{2}-\d{2}$/.test(body.scheduledDate)
      ? new Date(`${body.scheduledDate}T00:00:00+08:00`)
      : body?.scheduledDate === ""
        ? null
        : undefined;
  const cleanPhone = body?.recipientPhone !== undefined ? body.recipientPhone.trim().slice(0, 60) : undefined;
  const cleanAddr = body?.deliveryAddress !== undefined ? body.deliveryAddress.trim().slice(0, 500) : undefined;

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
    const resolvedStatus = nextStatus ?? existing[0]?.deliveryStatus ?? "pending";
    if (existing[0]) {
      await tx
        .update(deliveryOrders)
        .set({
          deliveryStatus: resolvedStatus,
          ...(parsedDate !== undefined ? { scheduledDate: parsedDate } : {}),
          ...(cleanPhone !== undefined ? { recipientPhone: cleanPhone } : {}),
          ...(cleanAddr !== undefined ? { deliveryAddress: cleanAddr } : {}),
          ...(cleanRemarks !== undefined ? { remarks: cleanRemarks || null } : {}),
        })
        .where(eq(deliveryOrders.id, existing[0].id));
    } else {
      await tx.insert(deliveryOrders).values({
        billId: bill.id,
        scheduledDate: parsedDate ?? null,
        recipientPhone: cleanPhone ?? "",
        deliveryAddress: cleanAddr ?? "",
        deliveryStatus: resolvedStatus,
        remarks: cleanRemarks || null,
      });
    }
    await tx.insert(auditLogs).values({
      shopId: bill.shopId,
      staffId: auth.session.staffId,
      action: auditAction,
      entityType: "bills",
      entityId: invoiceNo,
      details: {
        invoiceNo,
        deliveryStatus: resolvedStatus,
        scheduledDate: body?.scheduledDate ?? null,
        recipientPhone: cleanPhone ?? null,
        deliveryAddress: cleanAddr ?? null,
        remarks: cleanRemarks ?? null,
      },
    });
  });

  const [delivery] = await db
    .select()
    .from(deliveryOrders)
    .where(and(eq(deliveryOrders.billId, bill.id)))
    .limit(1);
  return NextResponse.json({
    ok: true,
    invoiceNo,
    deliveryStatus: delivery?.deliveryStatus ?? nextStatus ?? "pending",
    scheduledDate: body?.scheduledDate ?? null,
    recipientPhone: delivery?.recipientPhone ?? "",
    deliveryAddress: delivery?.deliveryAddress ?? "",
    remarks: delivery?.remarks ?? "",
  });
}
