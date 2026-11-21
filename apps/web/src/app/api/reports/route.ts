import { NextResponse } from "next/server";
import { formatHktBusinessDate, getOperationalReports } from "@hkharp/db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const today = formatHktBusinessDate();
  const fromDate = url.searchParams.get("from") ?? `${today.slice(0, 4)}-01-01`;
  const toDate = url.searchParams.get("to") ?? today;
  const report = await getOperationalReports({ fromDate, toDate });
  return NextResponse.json(report);
}
