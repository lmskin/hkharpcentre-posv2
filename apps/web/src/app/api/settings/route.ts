import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSettings, upsertAppSetting } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const UpsertSettingSchema = z.object({
  key: z.string().trim().min(1).max(64),
  shopId: z.number().int().nonnegative().default(0),
  value: z.record(z.unknown()),
});

export async function GET() {
  const settings = await getAppSettings();
  return NextResponse.json({ settings });
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedSession(5);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const raw = await request.json().catch(() => null);
  const parsed = UpsertSettingSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings payload" }, { status: 400 });
  }

  const res = await upsertAppSetting(parsed.data.key, parsed.data.value, parsed.data.shopId);
  return NextResponse.json(res);
}
