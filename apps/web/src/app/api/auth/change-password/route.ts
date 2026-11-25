import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, hashSecret, requireSharedDb, staff, verifySecret } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const ChangePasswordSchema = z
  .object({
    oldPassword: z.string().optional(),
    newPassword: z.string().min(4).max(128).optional(),
    newPin: z.string().regex(/^\d{6}$/, "收銀密碼必須為 6 位數字").optional(),
  })
  .refine((v) => Boolean(v.newPassword || v.newPin), {
    message: "請輸入新密碼或新 6 位收銀密碼",
  });

export async function POST(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = ChangePasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "新密碼最少四位（或輸入 6 位數字收銀密碼）", code: "045" }, { status: 400 });
  }

  const { db } = requireSharedDb();
  const [row] = await db.select().from(staff).where(eq(staff.id, auth.session.staffId)).limit(1);
  if (!row) {
    return NextResponse.json({ error: "找不到職員帳戶", code: "003" }, { status: 401 });
  }
  if (parsed.data.oldPassword !== undefined && parsed.data.oldPassword !== "" && !verifySecret(parsed.data.oldPassword, row.passwordHash)) {
    return NextResponse.json({ error: "舊密碼錯誤", code: "003" }, { status: 401 });
  }

  const updatePatch: Partial<typeof staff.$inferInsert> = {};
  if (parsed.data.newPassword) updatePatch.passwordHash = hashSecret(parsed.data.newPassword);
  if (parsed.data.newPin) updatePatch.pinHash = hashSecret(parsed.data.newPin);

  await db.update(staff).set(updatePatch).where(eq(staff.id, row.id));
  await db.insert(auditLogs).values({
    shopId: auth.session.shopId,
    staffId: auth.session.staffId,
    action: "CHANGE_PASSWORD",
    entityType: "staff",
    entityId: auth.session.legacyId,
    details: { changedPassword: Boolean(parsed.data.newPassword), changedPin: Boolean(parsed.data.newPin) },
  });
  return NextResponse.json({ ok: true, code: "000", message: "密碼已更改" });
}
