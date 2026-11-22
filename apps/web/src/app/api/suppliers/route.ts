import { NextResponse } from "next/server";
import { z } from "zod";
import { countSuppliers, listSuppliers, upsertSupplierRecord } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const UpsertSupplierSchema = z.object({
  id: z.number().int().positive().optional(),
  legacyId: z.string().trim().max(32).optional(),
  nameZh: z.string().trim().min(1).max(160),
  nameEn: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  active: z.boolean().optional(),
});

export async function GET(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? undefined;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "100") || 100));

  const [suppliers, total] = await Promise.all([listSuppliers({ q, limit }), countSuppliers(q)]);
  return NextResponse.json({ suppliers, total });
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedSession(4);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const parsed = UpsertSupplierSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid supplier payload", issues: parsed.error.issues }, { status: 400 });
  }

  const res = await upsertSupplierRecord(parsed.data);
  return NextResponse.json(res, { status: 201 });
}
