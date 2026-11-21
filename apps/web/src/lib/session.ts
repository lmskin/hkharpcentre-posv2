import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken, type SessionPayload } from "@hkharp/db";

export async function getCurrentSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

export async function requireAuthenticatedSession(minRoleLevel = 1): Promise<
  | { ok: true; session: SessionPayload }
  | { ok: false; status: 401 | 403; error: string }
> {
  const session = await getCurrentSession();
  if (!session) {
    return { ok: false, status: 401, error: "Staff authentication required. Please sign in at /login." };
  }
  if (session.roleLevel < minRoleLevel) {
    return {
      ok: false,
      status: 403,
      error: `Insufficient authority level (requires L${minRoleLevel}+, current L${session.roleLevel}).`,
    };
  }
  return { ok: true, session };
}
