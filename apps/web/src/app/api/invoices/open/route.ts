import { NextResponse } from "next/server";
import { listOpenInvoices } from "@hkharp/db";
import { INITIAL_OPEN_INVOICES } from "@/lib/sample-catalog";

export async function GET() {
  try {
    const dbInvoices = await listOpenInvoices(50);
    if (dbInvoices !== null) {
      return NextResponse.json({ source: "mysql8", invoices: dbInvoices });
    }
  } catch {
    // Fallback gracefully to starter open invoices until MySQL 8 is migrated and ETL-loaded
  }

  return NextResponse.json({
    source: "starter_fallback",
    invoices: INITIAL_OPEN_INVOICES,
  });
}
