import { NextResponse } from "next/server";
import { z } from "zod";
import {
  countCustomers,
  getCustomerPointLedger,
  listCustomerGrades,
  searchCustomers,
  upsertCustomerRecord,
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
});

export async function GET(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(request.url);
  const customerIdRaw = url.searchParams.get("customerId");
  if (customerIdRaw) {
    const ledger = await getCustomerPointLedger(Number(customerIdRaw));
    return NextResponse.json({ ledger });
  }
  const q = url.searchParams.get("q") ?? undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") ?? url.searchParams.get("limit") ?? "50") || 50));
  const [customers, total, grades] = await Promise.all([
    searchCustomers({ q, limit: pageSize, offset: (page - 1) * pageSize }),
    countCustomers(q),
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
