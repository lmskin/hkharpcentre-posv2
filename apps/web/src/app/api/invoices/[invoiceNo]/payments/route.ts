import { NextResponse } from "next/server";
import { z } from "zod";
import { RecordPaymentInputSchema, TenderCodeSchema } from "@hkharp/contracts";
import {
  cancelInvoicePaymentTx,
  requireSharedDb,
  settleInvoiceArTx,
  updateInvoicePaymentTx,
} from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const UpdatePaymentBodySchema = z.object({
  paymentId: z.number().int().positive(),
  tenderCode: TenderCodeSchema,
  amountHkd: z.number().positive(),
  remarks: z.string().max(255).optional(),
  referenceNo: z.string().max(64).optional(),
  approvalCode: z.string().max(16).optional(),
  cardLast4: z.string().max(4).optional(),
});

const DeletePaymentBodySchema = z.object({
  paymentId: z.number().int().positive(),
  reason: z.string().max(200).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ invoiceNo: string }> },
) {
  const auth = await requireAuthenticatedSession(2);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { invoiceNo } = await context.params;
  const raw = await request.json().catch(() => null);
  const parsed = RecordPaymentInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payment payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const { db } = requireSharedDb();
    const res = await settleInvoiceArTx(db, {
      invoiceNo: decodeURIComponent(invoiceNo),
      staffId: auth.session.staffId,
      payment: parsed.data,
    });
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Settlement failed" },
      { status: 422 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ invoiceNo: string }> },
) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { invoiceNo } = await context.params;
  const raw = await request.json().catch(() => null);
  const parsed = UpdatePaymentBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payment update payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const { db } = requireSharedDb();
    const res = await updateInvoicePaymentTx(db, {
      invoiceNo: decodeURIComponent(invoiceNo),
      staffId: auth.session.staffId,
      ...parsed.data,
    });
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update deposit payment" },
      { status: 422 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ invoiceNo: string }> },
) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { invoiceNo } = await context.params;
  const url = new URL(request.url);
  const qPaymentId = url.searchParams.get("paymentId");
  const rawBody = await request.json().catch(() => null);
  const rawInput =
    rawBody && typeof rawBody === "object"
      ? rawBody
      : qPaymentId
        ? { paymentId: Number(qPaymentId), reason: url.searchParams.get("reason") ?? undefined }
        : null;
  const parsed = DeletePaymentBodySchema.safeParse(rawInput);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid cancel payment payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const { db } = requireSharedDb();
    const res = await cancelInvoicePaymentTx(db, {
      invoiceNo: decodeURIComponent(invoiceNo),
      staffId: auth.session.staffId,
      paymentId: parsed.data.paymentId,
      reason: parsed.data.reason,
    });
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to cancel deposit payment" },
      { status: 422 },
    );
  }
}
