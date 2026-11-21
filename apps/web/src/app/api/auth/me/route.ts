import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";

export async function GET() {
  const user = await getCurrentSession();
  return NextResponse.json({ authenticated: Boolean(user), user });
}
