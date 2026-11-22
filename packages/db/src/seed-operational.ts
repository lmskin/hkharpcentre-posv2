import { eq, sql } from "drizzle-orm";
import { createDb, validateDatabaseUrl } from "./client";
import { hashSecret } from "./auth";
import { rolePermissions, staff, staffRoles } from "./schema/org-auth";
import { billSequences } from "./schema/sales-ar";
import { appSettings } from "./schema/stock-ops";

const ROLE_PERMISSION_MATRIX: Record<number, readonly string[]> = {
  1: ["POS_SELL", "ISSUE_INVOICE"],
  2: ["POS_SELL", "ISSUE_INVOICE", "SETTLE_AR"],
  3: ["POS_SELL", "ISSUE_INVOICE", "SETTLE_AR", "PRICE_OVERRIDE"],
  4: ["POS_SELL", "ISSUE_INVOICE", "SETTLE_AR", "PRICE_OVERRIDE", "VOID_BILL", "STOCK_ADJUST", "VIEW_COST"],
  5: [
    "POS_SELL",
    "ISSUE_INVOICE",
    "SETTLE_AR",
    "PRICE_OVERRIDE",
    "VOID_BILL",
    "STOCK_ADJUST",
    "VIEW_COST",
    "RUN_DAY_END",
    "MANAGE_SETTINGS",
  ],
};

async function main() {
  const url = validateDatabaseUrl(process.env.DATABASE_URL);
  const { db, pool } = createDb(url.toString());

  try {
    // 1. Seed role_permissions for L1..L5 roles
    const roles = await db.select().from(staffRoles);
    let permCount = 0;
    for (const role of roles) {
      const perms = ROLE_PERMISSION_MATRIX[role.legacyAuthorityLevel] ?? ROLE_PERMISSION_MATRIX[1]!;
      for (const perm of perms) {
        await pool.query(
          "INSERT INTO role_permissions (role_id, permission_key, allowed) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE allowed = 1",
          [role.id, perm],
        );
        permCount++;
      }
    }

    // 2. Assign known onboarding credentials for migrated staff 5002 (Admin L5) and 101 (Cashier L1)
    const onboardingUsers = [
      { legacyId: "5002", password: "ChangeMe!5002", pin: "000000" },
      { legacyId: "101", password: "Cashier!101", pin: "111111" },
    ];
    for (const u of onboardingUsers) {
      await db
        .update(staff)
        .set({
          passwordHash: hashSecret(u.password),
          pinHash: hashSecret(u.pin),
          active: true,
        })
        .where(eq(staff.legacyId, u.legacyId));
    }

    // 3. Ensure monotonic bill_sequences sit safely above migrated V47 counters
    const initialSequences = [
      { docType: "RETAIL_SALE", nextSeq: 30001 },
      { docType: "SALES_INVOICE", nextSeq: 20001 },
      { docType: "SALES_RETURN", nextSeq: 1001 },
      { docType: "PETTY_PAYOUT", nextSeq: 2001 },
      { docType: "GOODS_RECEIPT", nextSeq: 1001 },
      { docType: "PURCHASE_RETURN", nextSeq: 1001 },
      { docType: "STOCK_TRANSFER_OUT", nextSeq: 1001 },
      { docType: "STOCK_TRANSFER_IN", nextSeq: 1001 },
      { docType: "WRITE_OFF", nextSeq: 2001 },
      { docType: "STOCK_ADJUSTMENT", nextSeq: 1001 },
      { docType: "STOCKTAKE", nextSeq: 1001 },
    ];
    await pool.query("CREATE TABLE IF NOT EXISTS bill_sequences_tmp LIKE bill_sequences");
    await pool.query("DROP TABLE IF EXISTS bill_sequences_tmp");
    const [centralRows] = await pool.query("SELECT id FROM shops WHERE legacy_sn = 1 LIMIT 1");
    const centralShopId = Number((centralRows as Array<{ id: number }>)[0]?.id ?? 1);
    const [termRows] = await pool.query(
      "SELECT id FROM terminals WHERE shop_id = ? AND legacy_mn = 1 LIMIT 1",
      [centralShopId],
    );
    const mainTermId = Number((termRows as Array<{ id: number }>)[0]?.id ?? 1);

    for (const s of initialSequences) {
      await pool.query(
        "INSERT IGNORE INTO bill_sequences (shop_id, terminal_id, doc_type, next_seq) VALUES (?, ?, ?, ?)",
        [centralShopId, mainTermId, s.docType, s.nextSeq],
      );
    }

    // 4. Seed shop profile & printable invoice bank-transfer instructions in app_settings
    const settingsSeed = [
      {
        shopId: 0,
        key: "shop_profile",
        value: {
          nameZh: "香港豎琴中心",
          nameEn: "Hong Kong Harp Centre",
          addressEn: "Central, Hong Kong (On-Prem POS v2)",
          phone: "",
          currency: "HKD",
        },
      },
      {
        shopId: 0,
        key: "invoice_payment_instructions",
        value: {
          payeeName: "Hong Kong Harp Centre Limited",
          bankName: "HSBC Hong Kong (Configure live account details in Back Office -> Settings)",
          accountNumber: "Configure in /backoffice/settings",
          fpsId: "Configure in /backoffice/settings",
          paymentTermsNote:
            "Please quote Invoice Number on Bank Transfer / FPS reference and send payment slip to confirm receipt.",
        },
      },
      {
        shopId: centralShopId,
        key: "terminal_hardware",
        value: {
          octopusMode: "RWL_BRIDGE_X86",
          creditCardMode: "STANDALONE_TERMINAL",
          integratedPaxEdcEnabled: false,
          bridgeUrl: process.env.NEXT_PUBLIC_HARDWARE_BRIDGE_URL ?? "http://127.0.0.1:17880",
        },
      },
    ];

    for (const cfg of settingsSeed) {
      await pool.query(
        "INSERT IGNORE INTO app_settings (shop_id, setting_key, setting_value) VALUES (?, ?, ?)",
        [cfg.shopId, cfg.key, JSON.stringify(cfg.value)],
      );
    }

    const [permCnt] = await db.select({ c: sql<number>`COUNT(*)` }).from(rolePermissions);
    const [seqCnt] = await db.select({ c: sql<number>`COUNT(*)` }).from(billSequences);
    const [setCnt] = await db.select({ c: sql<number>`COUNT(*)` }).from(appSettings);

    console.log(
      JSON.stringify(
        {
          ok: true,
          rolePermissionsSeeded: Number(permCnt?.c ?? permCount),
          billSequencesCount: Number(seqCnt?.c ?? 0),
          appSettingsCount: Number(setCnt?.c ?? 0),
          onboardingAccountsConfigured: onboardingUsers.map((u) => u.legacyId),
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Operational seed failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
