import { NextResponse } from "next/server";
import {
  listBillQuery,
  listBillQueryItems,
  listBillQueryPayments,
  listInvoices,
  type BillQuerySearchField,
  type BillQuerySubFilter,
  type QueryMatchMode,
} from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const VALID_SUB_FILTERS = new Set<BillQuerySubFilter>([
  "all",
  "last30",
  "completed",
  "cancelled",
  "deposit",
  "not_received",
  "received",
  "rejected",
  "problem",
]);

const VALID_SEARCH_FIELDS = new Set<BillQuerySearchField>([
  "all",
  "customer_id",
  "customer_name",
  "invoice_no",
  "ubc",
  "sku",
  "name",
  "search_code",
  "tender",
  "notes",
]);

const VALID_MATCH_MODES = new Set<QueryMatchMode>(["prefix", "contains", "suffix"]);

export async function GET(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(request.url);
  const infoMode = url.searchParams.get("infoMode") ?? "order";
  const q = url.searchParams.get("q") ?? undefined;
  const date = url.searchParams.get("date") ?? undefined;
  const rawField = url.searchParams.get("searchField") as BillQuerySearchField | null;
  const searchField = rawField && VALID_SEARCH_FIELDS.has(rawField) ? rawField : "all";
  const rawMatch = url.searchParams.get("matchMode") as QueryMatchMode | null;
  const matchMode = rawMatch && VALID_MATCH_MODES.has(rawMatch) ? rawMatch : "contains";

  if (infoMode === "items") {
    const items = await listBillQueryItems({
      shopId: auth.session.shopId,
      q,
      date,
      searchField,
      matchMode,
    });
    return NextResponse.json({ items });
  }

  if (infoMode === "payments") {
    const payments = await listBillQueryPayments({
      shopId: auth.session.shopId,
      q,
      date,
      searchField,
      matchMode,
    });
    return NextResponse.json({ payments });
  }

  const view = url.searchParams.get("view");
  if (view === "today" || view === "held" || view === "office" || view === "unprocessed") {
    const rawSub = url.searchParams.get("subFilter") as BillQuerySubFilter | null;
    const subFilter = rawSub && VALID_SUB_FILTERS.has(rawSub) ? rawSub : "all";
    const invoices = await listBillQuery({
      view,
      shopId: auth.session.shopId,
      q,
      date,
      subFilter,
      searchField,
      matchMode,
    });
    return NextResponse.json({ invoices });
  }
  const statusParam = url.searchParams.get("status");
  const statusFilter =
    statusParam === "paid" || statusParam === "all" || statusParam === "open" ? statusParam : "open";
  const limit = Number(url.searchParams.get("limit") ?? "60");

  const invoices = await listInvoices({ statusFilter, q, limit });
  return NextResponse.json({ invoices });
}
