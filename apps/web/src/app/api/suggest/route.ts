import { NextResponse } from "next/server";
import { getFieldSuggestions, resolveActiveStoreContext, type SuggestKind } from "@hkharp/db";
import { getCurrentSession } from "@/lib/session";

const ALLOWED_KINDS: SuggestKind[] = [
  "staff_login",
  "product",
  "customer",
  "supplier",
  "invoice",
  "payment_ref",
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as SuggestKind | null;
  if (!kind || !ALLOWED_KINDS.includes(kind)) {
    return NextResponse.json({ error: "Invalid suggest kind" }, { status: 400 });
  }

  const q = url.searchParams.get("q") ?? "";
  const rawLimit = Number(url.searchParams.get("limit") ?? "10");
  const limit = Number.isFinite(rawLimit) ? Math.min(20, Math.max(1, rawLimit)) : 10;

  if (kind === "staff_login") {
    const suggestions = await getFieldSuggestions({ kind, q, limit });
    return NextResponse.json({ suggestions });
  }

  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const shopId = session.shopId || (await resolveActiveStoreContext()).shopId;
  const suggestions = await getFieldSuggestions({ kind, q, shopId, limit });
  return NextResponse.json({ suggestions });
}
