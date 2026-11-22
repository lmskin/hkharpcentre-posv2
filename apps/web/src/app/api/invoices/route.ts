import { NextResponse } from "next/server";
import { listBillQuery, listInvoices, type BillQuerySubFilter } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const VALID_SUB_FILTERS = new Set<BillQuerySubFilter>(["all", "last30", "completed", "cancelled", "deposit"]);

export async function GET(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(request.url);
  const view = url.searchParams.get("view");
  if (view === "today" || view === "held" || view === "office" || view === "unprocessed") {
    const q = url.searchParams.get("q") ?? undefined;
    const date = url.searchParams.get("date") ?? undefined;
    const rawSub = url.searchParams.get("subFilter") as BillQuerySubFilter | null;
    const subFilter = rawSub && VALID_SUB_FILTERS.has(rawSub) ? rawSub : "all";
    const invoices = await listBillQuery({
      view,
      shopId: auth.session.shopId,
      q,
      date,
      subFilter,
    });
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
