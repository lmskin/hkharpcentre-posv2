import { NextResponse } from "next/server";
import { listInvoices } from "@hkharp/db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const statusFilter =
    statusParam === "paid" || statusParam === "all" || statusParam === "open" ? statusParam : "open";
  const q = url.searchParams.get("q") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "60");

  const invoices = await listInvoices({ statusFilter, q, limit });
  return NextResponse.json({ invoices });
}
