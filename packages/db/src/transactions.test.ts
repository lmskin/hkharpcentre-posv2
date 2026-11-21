import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createDb, validateDatabaseUrl } from "./client";
import { hashSecret, verifySecret, signSessionToken, verifySessionToken } from "./auth";
import { createBillOrInvoiceTx, settleInvoiceArTx, voidBillTx } from "./transactions";
import { authenticateStaff } from "./queries";
import { staff, shops } from "./schema/org-auth";

function loadRootEnvForTests() {
  const envPath = path.resolve(__dirname, "../../../.env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

describe("@hkharp/db auth & ACID transactions", () => {
  it("hashes and verifies secrets and signs session tokens cleanly", () => {
    const hashed = hashSecret("000000");
    expect(verifySecret("000000", hashed)).toBe(true);
    expect(verifySecret("999999", hashed)).toBe(false);
    expect(verifySecret("anything", "scrypt-reset-required:abc:def")).toBe(false);

    const token = signSessionToken({
      staffId: 1,
      legacyId: "5002",
      displayName: "Admin",
      roleLevel: 5,
      shopId: 1,
    });
    const decoded = verifySessionToken(token);
    expect(decoded?.legacyId).toBe("5002");
    expect(decoded?.roleLevel).toBe(5);
  });

  describe("Live MySQL 8 integration (skipped only if DATABASE_URL unconfigured)", () => {
    let db: ReturnType<typeof createDb>["db"] | null = null;
    let pool: ReturnType<typeof createDb>["pool"] | null = null;
    let testStaffId = 0;
    let testShopId = 1;

    beforeAll(async () => {
      loadRootEnvForTests();
      try {
        const u = validateDatabaseUrl(process.env.DATABASE_URL);
        const conn = createDb(u.toString());
        db = conn.db;
        pool = conn.pool;
        const sRows = await db.select().from(staff).where(eq(staff.legacyId, "5002")).limit(1);
        testStaffId = sRows[0]?.id ?? 0;
        const shRows = await db.select().from(shops).where(eq(shops.legacySn, 1)).limit(1);
        testShopId = shRows[0]?.id ?? 1;
      } catch {
        db = null;
      }
    });

    afterAll(async () => {
      if (pool) await pool.end();
    });

    it("creates unpaid invoice -> settles via Bank Transfer (PM=5) -> voids cleanly", async () => {
      if (!db || !testStaffId) return;

      const authRes = await authenticateStaff({ pin: "000000" });
      expect(authRes?.legacyId).toBe("5002");

      const idemKey = `vitest-inv-${Date.now()}`;
      const issued = await createBillOrInvoiceTx(db, {
        clientIdempotencyKey: idemKey,
        shopId: testShopId,
        terminalId: 2,
        staffId: testStaffId,
        docType: "SALES_INVOICE",
        lines: [{ sku: "210810", nameZh: "Test Item", categoryC1: 1, quantity: 1, unitPriceHkd: 100 }],
        initialPayments: [],
        notes: "Vitest AR flow check",
      });
      expect(issued.paymentStatus).toBe("unpaid");
      expect(issued.balanceDueHkd).toBe(100);

      const replay = await createBillOrInvoiceTx(db, {
        clientIdempotencyKey: idemKey,
        shopId: testShopId,
        terminalId: 2,
        staffId: testStaffId,
        docType: "SALES_INVOICE",
        lines: [{ sku: "210810", nameZh: "Test Item", categoryC1: 1, quantity: 1, unitPriceHkd: 100 }],
        initialPayments: [],
      });
      expect(replay.idempotentReplay).toBe(true);
      expect(replay.invoiceNo).toBe(issued.invoiceNo);

      const settled = await settleInvoiceArTx(db, {
        invoiceNo: issued.invoiceNo,
        staffId: testStaffId,
        payment: {
          clientIdempotencyKey: `vitest-pmt-${Date.now()}`,
          tenderCode: "BANK_XFER",
          amountHkd: 100,
          referenceNo: "VITEST-TT-01",
        },
      });
      expect(settled.paymentStatus).toBe("paid");
      expect(settled.balanceDueHkd).toBe(0);

      const voided = await voidBillTx(db, {
        invoiceNo: issued.invoiceNo,
        staffId: testStaffId,
        reason: "Vitest cleanup reversal",
      });
      expect(voided.status).toBe("cancelled");
    });
  });
});
