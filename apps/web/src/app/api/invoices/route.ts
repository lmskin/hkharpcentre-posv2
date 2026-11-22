import { NextResponse } from "next/server";
import { listBillQuery, listInvoices } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

export async function GET(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(request.url);
  const view = url.searchParams.get("view");
  if (view === "today" || view === "held" || view === "office" || view === "unprocessed") {
    const invoices = await listBillQuery(view, auth.session.shopId);
    return NextResponse.json({ invoices });
  }
  const statusParam = url.searchParams.get("status");
  const statusFilter =
    statusParam === "paid" || statusParam === "all" || statusParam === "open" ? statusParam : "open";
  const q = url.searchParams.get("q") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "60");

  const invoices = await listInvoices({ statusFilter, q, limit });
  return NextResponse.json({ invoices });
}
