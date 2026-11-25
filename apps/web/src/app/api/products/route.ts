import { NextResponse } from "next/server";
import { z } from "zod";
import { countProducts, findExactProductByCode, listCategoriesAndUnits, searchProducts, upsertProductRecord } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const UpsertProductSchema = z.object({
  barcode: z.string().trim().min(1).max(40),
  ubc: z.string().trim().max(40).optional(),
  nameZh: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200).default(""),
  colorName: z.string().trim().max(80).optional(),
  sizeName: z.string().trim().max(80).optional(),
  legacyC1: z.number().int().min(0).max(999),
  sellPriceHkd: z.number().nonnegative(),
  fixedPriceHkd: z.number().nonnegative().nullable().optional(),
  allowItemDiscount: z.boolean().optional(),
  excludeFromCrmBonus: z.boolean().optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const exactCode = url.searchParams.get("exactCode");
  if (exactCode !== null) {
    const item = await findExactProductByCode(exactCode);
    return NextResponse.json({ item });
  }
  const q = url.searchParams.get("q") ?? undefined;
  const c1Raw = url.searchParams.get("categoryC1");
  const categoryC1 = c1Raw !== null && c1Raw !== "" ? Number(c1Raw) : undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") ?? url.searchParams.get("limit") ?? "60") || 60));

  const [items, total, lookups] = await Promise.all([
    searchProducts({ q, categoryC1, limit: pageSize, offset: (page - 1) * pageSize }),
    countProducts({ q, categoryC1 }),
    listCategoriesAndUnits(),
  ]);

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    categories: lookups.categories,
    units: lookups.units,
  });
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
