import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateStaff, recordLoginAudit, SESSION_COOKIE_NAME, signSessionToken } from "@hkharp/db";

const LoginInputSchema = z.object({
  staffCode: z.string().trim().optional(),
  password: z.string().optional(),
  pin: z.string().trim().optional(),
});

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = LoginInputSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid login payload" }, { status: 400 });
  }
  if (!parsed.data.pin && !(parsed.data.staffCode && parsed.data.password)) {
    return NextResponse.json({ error: "Provide either 6-digit PIN or staff code + password" }, { status: 400 });
  }

  try {
    const user = await authenticateStaff(parsed.data);
    if (!user) {
      await recordLoginAudit({
        staffCode: parsed.data.staffCode,
        mode: parsed.data.pin ? "pin" : "password",
        success: false,
      });
      return NextResponse.json({ error: "員工編號或密碼錯誤，請重新輸入", code: "003" }, { status: 401 });
    }

    await recordLoginAudit({
      staffId: user.staffId,
      shopId: user.shopId,
      staffCode: user.legacyId,
      mode: parsed.data.pin ? "pin" : "password",
      success: true,
    });
    const token = signSessionToken(user);
    const res = NextResponse.json({ ok: true, user });
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 16 * 3600,
    });
    return res;
  } catch {
    return NextResponse.json({ error: "POS 資料庫尚未完成遷移，請先執行 db:migrate", code: "900" }, { status: 503 });
  }
}
