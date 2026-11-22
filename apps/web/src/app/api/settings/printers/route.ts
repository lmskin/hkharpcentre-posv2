import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { appSettings, requireSharedDb, upsertAppSetting } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const PrinterSchema = z.object({
  key: z.enum(["Printer101", "Printer102", "Printer103", "Printer104"]),
  name: z.string().max(120),
  qty: z.number().int().min(1).max(9),
  language: z.enum(["TC", "SC", "ENG"]),
});
const PrinterConfigSchema = z.object({
  onOff: z.boolean(),
  printers: z.array(PrinterSchema).length(4),
});
const DEFAULT_CONFIG = {
  onOff: true,
  printers: ["Printer101", "Printer102", "Printer103", "Printer104"].map((key) => ({ key, name: "", qty: 1, language: "TC" })),
};

export async function GET() {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { db } = requireSharedDb();
  const [row] = await db.select().from(appSettings).where(and(eq(appSettings.shopId, auth.session.shopId), eq(appSettings.settingKey, "printers"))).limit(1);
  const parsed = PrinterConfigSchema.safeParse(row?.settingValue);
  return NextResponse.json({ config: parsed.success ? parsed.data : DEFAULT_CONFIG });
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = PrinterConfigSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "印表機設定格式錯誤" }, { status: 400 });
  await upsertAppSetting("printers", parsed.data, auth.session.shopId);
  return NextResponse.json({ ok: true, config: parsed.data });
}
