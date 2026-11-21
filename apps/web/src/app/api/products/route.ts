import { NextResponse } from "next/server";
import { z } from "zod";
import { listCategoriesAndUnits, searchProducts, upsertProductRecord } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const UpsertProductSchema = z.object({
  barcode: z.string().trim().min(1).max(40),
  nameZh: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).default(""),
  legacyC1: z.number().int().min(0).max(999),
  sellPriceHkd: z.number().nonnegative(),
  excludeFromCrmBonus: z.boolean().optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? undefined;
  const c1Raw = url.searchParams.get("categoryC1");
  const categoryC1 = c1Raw !== null && c1Raw !== "" ? Number(c1Raw) : undefined;
  const limit = Number(url.searchParams.get("limit") ?? "60");

  const [items, lookups] = await Promise.all([
    searchProducts({ q, categoryC1, limit }),
    listCategoriesAndUnits(),
  ]);

  return NextResponse.json({ items, categories: lookups.categories, units: lookups.units });
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedSession(4);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const parsed = UpsertProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid product data", issues: parsed.error.issues }, { status: 400 });
  }

  const res = await upsertProductRecord(parsed.data);
  return NextResponse.json(res, { status: res.created ? 201 : 200 });
}
