import { NextResponse } from "next/server";
import {
  formatHktBusinessDate,
  getHistoricalSalesReport,
  getHourlySalesReport,
  getItemSalesReport,
  getManagerStatsReport,
  getOperationalReports,
} from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

export async function GET(request: Request) {
  const auth = await requireAuthenticatedSession(4);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(request.url);
  const today = formatHktBusinessDate();
  const view = url.searchParams.get("view");
  const date = url.searchParams.get("date") ?? today;
  if (view === "hourly") {
    return NextResponse.json(await getHourlySalesReport(date, auth.session.shopId));
  }
  if (view === "items") {
    return NextResponse.json(await getItemSalesReport(date, auth.session.shopId));
  }

  const fromDate = url.searchParams.get("from") ?? `${today.slice(0, 4)}-01-01`;
  const toDate = url.searchParams.get("to") ?? today;
  if (view === "history") {
    return NextResponse.json(await getHistoricalSalesReport(fromDate, toDate, auth.session.shopId));
  }
  if (view === "stats") {
    return NextResponse.json(await getManagerStatsReport({ fromDate, toDate, shopId: auth.session.shopId }));
  }
  const report = await getOperationalReports({ fromDate, toDate, shopId: auth.session.shopId });
  return NextResponse.json(report);
}
