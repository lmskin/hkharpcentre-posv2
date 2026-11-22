import { NextResponse } from "next/server";
import { z } from "zod";
import { auditLogs, octopusSettlements, requireSharedDb, resolveActiveStoreContext } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const SettleOctopusSchema = z.object({
  xfileName: z.string().trim().max(120).optional(),
  runOsdxcExchange: z.boolean().default(false),
});

export async function POST(request: Request) {
  const auth = await requireAuthenticatedSession(2);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const parsed = SettleOctopusSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Octopus settlement request" }, { status: 400 });
  }

  const bridgeUrl =
    process.env.HARDWARE_BRIDGE_URL ??
    process.env.NEXT_PUBLIC_HARDWARE_BRIDGE_URL ??
    "http://127.0.0.1:17880";
  const bridgeToken = process.env.HARDWARE_BRIDGE_TOKEN ?? "dev-local-bridge-token-change-me";

  let xfileSummary: {
    pendingLocks?: number;
    journalTransactions?: number;
    totalCents?: number;
    generatedAtIso?: string;
  } = {};

  try {
    const res = await fetch(`${bridgeUrl}/octopus/xfile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Token": bridgeToken,
      },
      body: JSON.stringify({ runOsdxcExchange: parsed.data.runOsdxcExchange }),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Hardware bridge XFile failed (${res.status})` }, { status: 502 });
    }
    xfileSummary = (await res.json()) as typeof xfileSummary;
  } catch {
    return NextResponse.json({ error: "Unable to reach local Octopus hardware bridge" }, { status: 502 });
  }

  const storeCtx = await resolveActiveStoreContext();
  const shopId = auth.session.shopId || storeCtx.shopId;
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const xfileName = parsed.data.xfileName || `XFILE-${stamp}.DAT`;
  const txnCount = Number(xfileSummary.journalTransactions ?? 0);
  const totalCents = Number(xfileSummary.totalCents ?? 0);

  const { db } = requireSharedDb();
  const inserted = await db.insert(octopusSettlements).values({
    shopId,
    terminalId: storeCtx.terminalId,
    xfileName,
    txnCount,
    totalCents,
    osdxcUploaded: parsed.data.runOsdxcExchange,
  });

  await db.insert(auditLogs).values({
    shopId,
    staffId: auth.session.staffId,
    action: "OCTOPUS_XFILE_SETTLE",
    entityType: "octopus_settlements",
    entityId: String(inserted[0].insertId),
    details: { xfileName, txnCount, totalCents, osdxcUploaded: parsed.data.runOsdxcExchange },
  });

  return NextResponse.json(
    {
      ok: true,
      id: Number(inserted[0].insertId),
      xfileName,
      txnCount,
      totalCents,
      pendingLocks: Number(xfileSummary.pendingLocks ?? 0),
      osdxcUploaded: parsed.data.runOsdxcExchange,
    },
    { status: 201 },
  );
}
