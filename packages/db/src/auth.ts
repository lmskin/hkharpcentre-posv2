import crypto from "node:crypto";

export interface SessionPayload {
  staffId: number;
  legacyId: string;
  displayName: string;
  roleLevel: number;
  shopId: number;
  exp: number;
}

export const SESSION_COOKIE_NAME = "hkharp_session";

export function hashSecret(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 32).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifySecret(plain: string, stored: string | null | undefined): boolean {
  if (!stored || !plain) return false;
  if (!stored.startsWith("scrypt:")) return false;
  const parts = stored.split(":");
  if (parts.length !== 3) return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;

  try {
    const derived = crypto.scryptSync(plain, salt, 32);
    const expected = Buffer.from(expectedHex, "hex");
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function getSessionSigningSecret(): string {
  return process.env.SESSION_SECRET || "dev-local-session-secret-change-in-prod";
}

export function signSessionToken(payload: Omit<SessionPayload, "exp">, ttlHours = 16): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlHours * 3600,
  };
  const body = Buffer.from(JSON.stringify(fullPayload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getSessionSigningSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expectedSig = crypto
    .createHmac("sha256", getSessionSigningSecret())
    .update(body)
    .digest("base64url");

  try {
    const actualBuf = Buffer.from(sig, "utf8");
    const expectedBuf = Buffer.from(expectedSig, "utf8");
    if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
      return null;
    }
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
