import { NextResponse } from "next/server";
import { getInvoiceDetailByNo } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

export async function GET(
  _request: Request,
  context: { params: Promise<{ invoiceNo: string }> },
) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { invoiceNo } = await context.params;
  const detail = await getInvoiceDetailByNo(decodeURIComponent(invoiceNo));
  if (!detail) return NextResponse.json({ error: "單據不存在" }, { status: 404 });
  return NextResponse.json(detail);
}
