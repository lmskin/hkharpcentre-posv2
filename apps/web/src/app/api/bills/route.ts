import { NextResponse } from "next/server";
import { IssueBillOrInvoiceInputSchema } from "@hkharp/contracts";
import { createBillOrInvoiceTx, requireSharedDb } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

export async function POST(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const raw = await request.json().catch(() => null);
  const parsed = IssueBillOrInvoiceInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const { db } = requireSharedDb();
    const result = await createBillOrInvoiceTx(db, {
      clientIdempotencyKey: parsed.data.clientIdempotencyKey,
      shopId: auth.session.shopId || parsed.data.shopId,
      terminalId: parsed.data.terminalId,
      staffId: auth.session.staffId,
      docType: parsed.data.docType,
      customerId: parsed.data.customerId,
      lines: parsed.data.lines,
      initialPayments: parsed.data.initialPayments,
      notes: parsed.data.notes,
    });
    return NextResponse.json(result, { status: result.idempotentReplay ? 200 : 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save transaction" },
      { status: 422 },
    );
  }
}
