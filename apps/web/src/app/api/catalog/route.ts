import { NextResponse } from "next/server";
import { listCatalogProducts } from "@hkharp/db";
import { STARTER_CATALOG } from "@/lib/sample-catalog";

export async function GET() {
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
