import { NextResponse } from "next/server";
import { pingMySqlHealth } from "@hkharp/db";

export async function GET() {
  const mysql = await pingMySqlHealth();

  return NextResponse.json({
    ok: true,
    service: "@hkharp/web",
    hardwareBridgeUrl: process.env.NEXT_PUBLIC_HARDWARE_BRIDGE_URL ?? "http://127.0.0.1:17880",
    integratedPaxEdcEnabled: process.env.ENABLE_INTEGRATED_PAX_EDC === "true",
    mysql,
    confirmedPaymentConfig: {
      pm3MasterCard: true,
      octopusBridge: "win-x86 rwl.dll",
      creditCardsMode: "standalone_bank_terminal",
      arWorkflow: "issue_invoice_then_bank_transfer",
    },
  });
}
