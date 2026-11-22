import { NextResponse } from "next/server";
import { formatHktBusinessDate, getHistoricalSalesReport } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

export async function GET(request: Request) {
  const auth = await requireAuthenticatedSession(4);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = new URL(request.url).searchParams;
  const today = formatHktBusinessDate();
  const from = params.get("from") ?? `${today.slice(0, 8)}01`;
  const to = params.get("to") ?? today;
  if (![from, to].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)) || from > to) {
    return NextResponse.json({ error: "日期範圍錯誤" }, { status: 400 });
  }
  return NextResponse.json(await getHistoricalSalesReport(from, to, auth.session.shopId));
}
