import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSharedDb, voidBillTx } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const VoidBodySchema = z.object({
  reason: z.string().trim().min(1).max(200),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ invoiceNo: string }> },
) {
  const auth = await requireAuthenticatedSession(4);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { invoiceNo } = await context.params;
  const raw = await request.json().catch(() => null);
  const parsed = VoidBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Void reason required" }, { status: 400 });
  }

  try {
    const { db } = requireSharedDb();
    const res = await voidBillTx(db, {
      invoiceNo: decodeURIComponent(invoiceNo),
      staffId: auth.session.staffId,
      reason: parsed.data.reason,
    });
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Void failed" },
      { status: 422 },
    );
  }
}
