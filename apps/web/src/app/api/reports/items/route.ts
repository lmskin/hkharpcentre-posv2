import { NextResponse } from "next/server";
import { formatHktBusinessDate, getItemSalesReport } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

export async function GET(request: Request) {
  const auth = await requireAuthenticatedSession(4);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = new URL(request.url).searchParams;
  const today = formatHktBusinessDate();
  const date = params.get("from") ?? params.get("date") ?? today;
  const toDate = params.get("to") ?? date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || date > toDate) {
    return NextResponse.json({ error: "日期格式錯誤" }, { status: 400 });
  }
  const rawC1 = params.get("categoryC1");
  const categoryC1 = rawC1 && /^\d+$/.test(rawC1) ? Number(rawC1) : undefined;
  const q = params.get("q") ?? undefined;
  return NextResponse.json(await getItemSalesReport(date, auth.session.shopId, { toDate, categoryC1, q }));
}
