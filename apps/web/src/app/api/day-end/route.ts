import { NextResponse } from "next/server";
import { z } from "zod";
import {
  auditLogs,
  authorizeManagerOverride,
  closeDayEndBatchTx,
  formatHktBusinessDate,
  getDayEndPreview,
  requireSharedDb,
  resolveActiveStoreContext,
  upsertAppSetting,
} from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const CloseDayEndSchema = z.object({
  action: z.enum(["CLOSE", "SET_FLOAT"]).default("CLOSE"),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountHkd: z.number().nonnegative().optional(),
  managerPin: z.string().trim().max(16).optional(),
  countedByTender: z
    .array(
      z.object({
        tenderCode: z.string(),
        countedAmountHkd: z.number().nonnegative(),
      }),
    )
    .default([]),
});

export async function GET(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(request.url);
  const businessDate = url.searchParams.get("date") ?? formatHktBusinessDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return NextResponse.json({ error: "日期格式錯誤" }, { status: 400 });
  const storeCtx = await resolveActiveStoreContext();
  const preview = await getDayEndPreview(businessDate, auth.session.shopId || storeCtx.shopId);
  return NextResponse.json(preview);
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const raw = await request.json().catch(() => null);
  const parsed = CloseDayEndSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid day-end payload", issues: parsed.error.issues }, { status: 400 });
  }

  const storeCtx = await resolveActiveStoreContext();
  const shopId = auth.session.shopId || storeCtx.shopId;

  if (parsed.data.action === "SET_FLOAT") {
    const amountHkd = Number(parsed.data.amountHkd ?? 0);
    await upsertAppSetting(
      `opening_float_${parsed.data.businessDate}`,
      { amountHkd, staffId: auth.session.staffId, updatedAtIso: new Date().toISOString() },
      shopId,
    );
    const { db } = requireSharedDb();
    await db.insert(auditLogs).values({
      shopId,
      staffId: auth.session.staffId,
      action: "SET_OPENING_FLOAT",
      entityType: "app_settings",
      entityId: `opening_float_${parsed.data.businessDate}`,
      details: { businessDate: parsed.data.businessDate, amountHkd },
    });
    return NextResponse.json({ ok: true, businessDate: parsed.data.businessDate, openingFloatHkd: amountHkd });
  }

  let authorizedByStaffId: number | undefined;
  if (auth.session.roleLevel < 4) {
    const supervisor = parsed.data.managerPin
      ? await authorizeManagerOverride(parsed.data.managerPin, 4)
      : null;
    if (!supervisor) {
      return NextResponse.json(
        { error: "Insufficient authority level (requires L4+ or valid Manager PIN)." },
        { status: 403 },
      );
    }
    authorizedByStaffId = supervisor.staffId;
  }

  try {
    const { db } = requireSharedDb();
    const res = await closeDayEndBatchTx(db, {
      shopId,
      terminalId: storeCtx.terminalId,
      staffId: auth.session.staffId,
      businessDate: parsed.data.businessDate,
      countedByTender: parsed.data.countedByTender,
      authorizedByStaffId,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "日結失敗" }, { status: 422 });
  }
}
