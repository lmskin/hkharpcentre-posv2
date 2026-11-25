import { cookies } from "next/headers";
import {
  resolveDefaultDevSession,
  SESSION_COOKIE_NAME,
  verifySessionToken,
  type SessionPayload,
} from "@hkharp/db";

/**
 * Login is disabled by default while this is a development website.
 * Set AUTH_REQUIRED=true (or NEXT_PUBLIC_AUTH_REQUIRED=true) to enforce staff sign-in.
 */
export function isAuthRequired(): boolean {
  return process.env.AUTH_REQUIRED === "true" || process.env.NEXT_PUBLIC_AUTH_REQUIRED === "true";
}

export async function getCurrentSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  const cookieSession = verifySessionToken(token);
  if (cookieSession) {
    return cookieSession;
  }
  if (!isAuthRequired()) {
    return resolveDefaultDevSession();
  }
  return null;
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
