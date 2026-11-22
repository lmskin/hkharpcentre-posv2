import { NextResponse } from "next/server";
import { formatHktBusinessDate, getItemSalesReport } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

export async function GET(request: Request) {
  const auth = await requireAuthenticatedSession(4);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const date = new URL(request.url).searchParams.get("date") ?? formatHktBusinessDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "日期格式錯誤" }, { status: 400 });
  return NextResponse.json(await getItemSalesReport(date, auth.session.shopId));
}
