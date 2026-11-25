import { NextResponse } from "next/server";
import {
  listCatalogProducts,
  listStockPage,
  type QueryMatchMode,
  type StockFilterMode,
  type StockSortMode,
} from "@hkharp/db";
import { STARTER_CATALOG } from "@/lib/sample-catalog";
import { requireAuthenticatedSession } from "@/lib/session";

const VALID_MATCH = new Set<QueryMatchMode>(["prefix", "contains", "suffix"]);
const VALID_STOCK_FILTER = new Set<StockFilterMode>(["all", "positive", "negative", "zero"]);
const VALID_SORT = new Set<StockSortMode>(["barcode", "name", "qty_desc", "qty_asc"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("view") === "stock") {
    const auth = await requireAuthenticatedSession(1);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const c1Raw = url.searchParams.get("categoryC1");
    const categoryC1 = c1Raw !== null && c1Raw !== "" ? Number(c1Raw) : undefined;
    const rawMatch = url.searchParams.get("matchMode") as QueryMatchMode | null;
    const rawFilter = url.searchParams.get("stockFilter") as StockFilterMode | null;
    const rawSort = url.searchParams.get("sortBy") as StockSortMode | null;
    const result = await listStockPage({
      q: url.searchParams.get("q") ?? undefined,
      categoryC1,
      matchMode: rawMatch && VALID_MATCH.has(rawMatch) ? rawMatch : "contains",
      stockFilter: rawFilter && VALID_STOCK_FILTER.has(rawFilter) ? rawFilter : "all",
      sortBy: rawSort && VALID_SORT.has(rawSort) ? rawSort : "barcode",
      page: Number(url.searchParams.get("page") ?? "1"),
      pageSize: Number(url.searchParams.get("pageSize") ?? "80"),
      shopId: auth.session.shopId,
    });
    return NextResponse.json({ source: "mysql8", ...result });
  }
  try {
    const dbItems = await listCatalogProducts(80);
    if (dbItems && dbItems.length > 0) {
      return NextResponse.json({ source: "mysql8", items: dbItems });
    }
  } catch {
    // Fallback gracefully to starter catalog until MySQL 8 is migrated and ETL-loaded
  }

  return NextResponse.json({
    source: "starter_fallback",
    items: STARTER_CATALOG.map((item) => ({
      ...item,
      excludeFromCrmBonus: false,
    })),
  });
}
