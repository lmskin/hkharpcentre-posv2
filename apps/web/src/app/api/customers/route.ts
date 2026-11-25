import { NextResponse } from "next/server";
import { z } from "zod";
import {
  countCustomers,
  getCustomerPointLedger,
  getNextCustomerLegacyId,
  listCustomerGrades,
  searchCustomers,
  upsertCustomerRecord,
  type CustomerSearchField,
  type CustomerSortBy,
} from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const UpsertCustomerSchema = z.object({
  id: z.number().int().positive().optional(),
  legacyId: z.string().trim().max(32).optional(),
  gradeId: z.number().int().positive().nullable().optional(),
  cardNo: z.string().trim().max(40).optional(),
  nameZh: z.string().trim().min(1).max(160),
  nameEn: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(160).optional(),
  address: z.string().trim().max(300).optional(),
});

export async function GET(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(request.url);
  if (url.searchParams.get("nextId") === "1") {
    const nextLegacyId = await getNextCustomerLegacyId();
    return NextResponse.json({ nextLegacyId });
  }
  const customerIdRaw = url.searchParams.get("customerId");
  if (customerIdRaw) {
    const ledger = await getCustomerPointLedger(Number(customerIdRaw));
    return NextResponse.json({ ledger });
  }
  const q = url.searchParams.get("q") ?? undefined;
  const searchFieldRaw = url.searchParams.get("searchField") ?? "all";
  const searchField: CustomerSearchField =
    searchFieldRaw === "id" || searchFieldRaw === "name" || searchFieldRaw === "phone"
      ? searchFieldRaw
      : "all";
  const sortByRaw = url.searchParams.get("sortBy") ?? "newest_id";
  const sortBy: CustomerSortBy = sortByRaw === "points" ? "points" : "newest_id";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") ?? url.searchParams.get("limit") ?? "50") || 50));
  const [customers, total, grades] = await Promise.all([
    searchCustomers({ q, searchField, sortBy, limit: pageSize, offset: (page - 1) * pageSize }),
    countCustomers(q, searchField),
    listCustomerGrades(),
  ]);
  return NextResponse.json({
    customers,
    grades,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null);
  const parsed = UpsertCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid customer payload", issues: parsed.error.issues }, { status: 400 });
  }

  const res = await upsertCustomerRecord(parsed.data);
  return NextResponse.json(res, { status: 201 });
}
