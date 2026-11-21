import { NextResponse } from "next/server";
import { RecordPaymentInputSchema } from "@hkharp/contracts";
import { requireSharedDb, settleInvoiceArTx } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

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
