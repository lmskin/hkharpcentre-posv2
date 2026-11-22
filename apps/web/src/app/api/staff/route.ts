import { NextResponse } from "next/server";
import { listStaffPage } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

export async function GET(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(request.url);
  const result = await listStaffPage({
    q: url.searchParams.get("q") ?? undefined,
    page: Number(url.searchParams.get("page") ?? "1"),
    pageSize: Number(url.searchParams.get("pageSize") ?? "12"),
  });
  return NextResponse.json(result);
}
