import { NextResponse } from "next/server";
import { z } from "zod";
import {
  closeDayEndBatchTx,
  formatHktBusinessDate,
  getDayEndPreview,
  requireSharedDb,
} from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const CloseDayEndSchema = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  countedByTender: z
    .array(
      z.object({
        tenderCode: z.string(),
        countedAmountHkd: z.number().nonnegative(),
      }),
    )
    .default([]),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const businessDate = url.searchParams.get("date") ?? formatHktBusinessDate();
  const preview = await getDayEndPreview(businessDate);
  return NextResponse.json(preview);
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedSession(4);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const raw = await request.json().catch(() => null);
  const parsed = CloseDayEndSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid day-end payload", issues: parsed.error.issues }, { status: 400 });
  }

  const { db } = requireSharedDb();
  const res = await closeDayEndBatchTx(db, {
    shopId: auth.session.shopId || 1,
    terminalId: Number(process.env.TERMINAL_ID ?? "2"),
    staffId: auth.session.staffId,
    businessDate: parsed.data.businessDate,
    countedByTender: parsed.data.countedByTender,
  });
  return NextResponse.json(res, { status: 201 });
}
