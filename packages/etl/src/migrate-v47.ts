import crypto from "node:crypto";
import mysql, { type Connection } from "mysql2/promise";
import { validateDatabaseUrl } from "@hkharp/db";
import { classifyLegacyInvoiceArState } from "./invoice-ar-link";
import { getDefaultLegacyConfig, querySqlcmdJson } from "./mssql-read";
import { LEGACY_PAY_METHOD_MAP } from "./pay-method-map";

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function execBatchUpsert(
  conn: Connection,
  sqlPrefix: string,
  colCount: number,
  rows: unknown[][],
  sqlSuffix: string,
  batchSize = 500,
) {
  if (rows.length === 0) return;
  const placeholderRow = `(${new Array(colCount).fill("?").join(", ")})`;
  for (const chunk of chunkArray(rows, batchSize)) {
    const valuesSql = new Array(chunk.length).fill(placeholderRow).join(", ");
    const flatParams: unknown[] = [];
    for (const r of chunk) flatParams.push(...r);
    await conn.query(`${sqlPrefix} ${valuesSql} ${sqlSuffix}`, flatParams);
  }
}

function mapXcToDocType(xc: number): string {
  switch (xc) {
    case 1:
      return "GOODS_RECEIPT";
    case 4:
      return "PURCHASE_RETURN";
    case 9:
      return "SALES_RETURN";
    case 10:
      return "WRITE_OFF";
    case 12:
      return "PETTY_PAYOUT";
    case 13:
      return "STOCK_TRANSFER_OUT";
    case 14:
      return "STOCK_TRANSFER_IN";
    case 15:
      return "STOCK_ADJUSTMENT";
    case 22:
    case 23:
      return "SALES_INVOICE";
    case 54:
      return "CRM_POINT_TXN";
    case 93:
      return "STOCKTAKE";
    case 99:
    default:
      return "RETAIL_SALE";
  }
}

function clampStr(val: string | null | undefined, maxLen: number): string {
  if (!val) return "";
  return val.trim().slice(0, maxLen);
}

function toDec4(val: number | string | null | undefined): string {
  const n = Number(val ?? 0);
  if (!Number.isFinite(n)) return "0.0000";
  return n.toFixed(4);
}

function toDec6(val: number | string | null | undefined): string {
  const n = Number(val ?? 0);
  if (!Number.isFinite(n)) return "0.000000";
  return n.toFixed(6);
}

async function main() {
  const t0 = Date.now();
  const parsedUrl = validateDatabaseUrl(process.env.DATABASE_URL);
  const legacy = getDefaultLegacyConfig();
  const conn = await mysql.createConnection({
    uri: parsedUrl.toString(),
    timezone: "+08:00",
    decimalNumbers: false,
  });

  try {
    // 1. Shops & Terminals
    const shopRows = await querySqlcmdJson<{ KY: number; zh: string; en: string }>(
      legacy.server,
      legacy.gsDatabase,
      "SELECT KY, dbo.Encrypt(D1L, 0) AS zh, dbo.Encrypt(D2L, 0) AS en FROM dbo.CustomerData WHERE dbo.Encrypt(TP, 0) = N'ShopNo' ORDER BY KY",
    );
    const shopMap = new Map<number, { zh: string; en: string }>();
    for (const r of shopRows) {
      shopMap.set(r.KY, { zh: clampStr(r.zh, 120) || `Shop ${r.KY}`, en: clampStr(r.en, 120) || `Shop ${r.KY}` });
    }
    if (!shopMap.has(0)) shopMap.set(0, { zh: "辦公室", en: "Office" });
    if (!shopMap.has(1)) shopMap.set(1, { zh: "中環門市", en: "Central" });

    await execBatchUpsert(
      conn,
      "INSERT INTO shops (legacy_sn, code, name_zh, name_en, active) VALUES",
      5,
      Array.from(shopMap.entries()).map(([sn, info]) => [
        sn,
        sn === 0 ? "OFFICE" : sn === 1 ? "CENTRAL" : `SHOP_${sn}`,
        info.zh,
        info.en,
        1,
      ]),
      "ON DUPLICATE KEY UPDATE name_zh = VALUES(name_zh), name_en = VALUES(name_en)",
    );

    const [shopDbRows] = await conn.query("SELECT id, legacy_sn FROM shops");
    const shopIdBySn = new Map<number, number>();
    for (const r of shopDbRows as Array<{ id: number; legacy_sn: number }>) {
      shopIdBySn.set(r.legacy_sn, r.id);
    }

    const distinctTermRows = await querySqlcmdJson<{ SN: number; MN: number }>(
      legacy.server,
      legacy.gxDatabase,
      `SELECT DISTINCT SN, MN FROM (
        SELECT SN, MN FROM dbo.HistHeader
        UNION SELECT SN, MN FROM dbo.OfficeXHeader
        UNION SELECT SN, MN FROM dbo.BatchHeader
        UNION SELECT 0 AS SN, 1 AS MN
        UNION SELECT 1 AS SN, 1 AS MN
        UNION SELECT 1 AS SN, 2 AS MN
      ) T`,
    );
    await execBatchUpsert(
      conn,
      "INSERT INTO terminals (shop_id, legacy_mn, name, octopus_enabled, integrated_pax_edc_enabled, active) VALUES",
      6,
      distinctTermRows.map((t) => [
        shopIdBySn.get(t.SN) ?? shopIdBySn.get(1)!,
        t.MN,
        `Counter ${t.SN}-${t.MN}`,
        t.SN === 1 && t.MN === 1 ? 1 : 0,
        0,
        t.MN === 2 ? 0 : 1,
      ]),
      "ON DUPLICATE KEY UPDATE name = VALUES(name)",
    );
    const [termDbRows] = await conn.query(
      "SELECT t.id, s.legacy_sn, t.legacy_mn FROM terminals t JOIN shops s ON s.id = t.shop_id",
    );
    const termIdBySnMn = new Map<string, number>();
    for (const r of termDbRows as Array<{ id: number; legacy_sn: number; legacy_mn: number }>) {
      termIdBySnMn.set(`${r.legacy_sn}:${r.legacy_mn}`, r.id);
    }

    // 2. Pay Methods (PM=0..7; PM=3 confirmed MasterCard; PM=8 retired)
    const activePms = Object.values(LEGACY_PAY_METHOD_MAP).filter((m) => m.tenderCode !== null);
    await execBatchUpsert(
      conn,
      "INSERT INTO pay_methods (legacy_pm, code, mode, name_zh, name_en, active) VALUES",
      6,
      activePms.map((m) => [m.legacyPm, m.tenderCode!, m.mode, m.nameZh, m.nameEn, 1]),
      "ON DUPLICATE KEY UPDATE code = VALUES(code), mode = VALUES(mode), name_zh = VALUES(name_zh), name_en = VALUES(name_en)",
    );
    const [pmDbRows] = await conn.query("SELECT id, legacy_pm FROM pay_methods WHERE legacy_pm IS NOT NULL");
    const payMethodIdByPm = new Map<number, number>();
    for (const r of pmDbRows as Array<{ id: number; legacy_pm: number }>) {
      payMethodIdByPm.set(r.legacy_pm, r.id);
    }

    // 3. Categories & Units (from CustomerData + ProductOnSale fallback)
    const catRows = await querySqlcmdJson<{ KY: number; zh: string; en: string; SQ: number }>(
      legacy.server,
      legacy.gsDatabase,
      "SELECT KY, dbo.Encrypt(D1L, 0) AS zh, dbo.Encrypt(D2L, 0) AS en, SQ FROM dbo.CustomerData WHERE dbo.Encrypt(TP, 0) = N'Category1' AND SN = 0",
    );
    const prodC1Rows = await querySqlcmdJson<{ C1: number }>(
      legacy.server,
      legacy.gsDatabase,
      "SELECT DISTINCT C1 FROM dbo.ProductOnSale",
    );
    const catMap = new Map<number, { zh: string; en: string; sq: number }>();
    for (const c of catRows) {
      catMap.set(c.KY, {
        zh: clampStr(c.zh, 120) || `Category ${c.KY}`,
        en: clampStr(c.en, 120) || `Category ${c.KY}`,
        sq: Number(c.SQ ?? c.KY),
      });
    }
    for (const p of prodC1Rows) {
      if (!catMap.has(p.C1)) {
        catMap.set(p.C1, { zh: `分類 ${p.C1}`, en: `Category ${p.C1}`, sq: p.C1 });
      }
    }
    await execBatchUpsert(
      conn,
      "INSERT INTO categories (legacy_c1, name_zh, name_en, sort_order) VALUES",
      4,
      Array.from(catMap.entries()).map(([c1, info]) => [c1, info.zh, info.en, info.sq]),
      "ON DUPLICATE KEY UPDATE name_zh = VALUES(name_zh), name_en = VALUES(name_en)",
    );
    const [catDbRows] = await conn.query("SELECT id, legacy_c1 FROM categories");
    const categoryIdByC1 = new Map<number, number>();
    for (const r of catDbRows as Array<{ id: number; legacy_c1: number }>) {
      categoryIdByC1.set(r.legacy_c1, r.id);
    }

    const unitRows = await querySqlcmdJson<{ KY: number; zh: string; en: string }>(
      legacy.server,
      legacy.gsDatabase,
      "SELECT KY, dbo.Encrypt(D1L, 0) AS zh, dbo.Encrypt(D2L, 0) AS en FROM dbo.CustomerData WHERE dbo.Encrypt(TP, 0) = N'Unit' AND SN = 0",
    );
    const prodUnRows = await querySqlcmdJson<{ UN: number }>(
      legacy.server,
      legacy.gsDatabase,
      "SELECT DISTINCT UN FROM dbo.ProductOnSale",
    );
    const unitMap = new Map<number, { zh: string; en: string }>();
    for (const u of unitRows) {
      unitMap.set(u.KY, { zh: clampStr(u.zh, 40) || `Unit ${u.KY}`, en: clampStr(u.en, 40) || `Unit ${u.KY}` });
    }
    for (const u of prodUnRows) {
      if (!unitMap.has(u.UN)) unitMap.set(u.UN, { zh: `單位 ${u.UN}`, en: `Unit ${u.UN}` });
    }
    await execBatchUpsert(
      conn,
      "INSERT INTO units (legacy_un, name_zh, name_en) VALUES",
      3,
      Array.from(unitMap.entries()).map(([un, info]) => [un, info.zh, info.en]),
      "ON DUPLICATE KEY UPDATE name_zh = VALUES(name_zh), name_en = VALUES(name_en)",
    );
    const [unitDbRows] = await conn.query("SELECT id, legacy_un FROM units");
    const unitIdByUn = new Map<number, number>();
    for (const r of unitDbRows as Array<{ id: number; legacy_un: number }>) {
      unitIdByUn.set(r.legacy_un, r.id);
    }

    // 4. Staff Roles & Staff (hash placeholder password, never import plaintext/XOR legacy SPW or print PII)
    await execBatchUpsert(
      conn,
      "INSERT INTO staff_roles (code, name, legacy_authority_level) VALUES",
      3,
      [
        ["LEVEL_1", "Cashier L1", 1],
        ["LEVEL_2", "Staff L2", 2],
        ["LEVEL_3", "Senior Staff L3", 3],
        ["LEVEL_4", "Supervisor L4", 4],
        ["LEVEL_5", "Administrator L5", 5],
      ],
      "ON DUPLICATE KEY UPDATE name = VALUES(name)",
    );
    const [roleDbRows] = await conn.query("SELECT id, legacy_authority_level FROM staff_roles");
    const roleIdByLevel = new Map<number, number>();
    for (const r of roleDbRows as Array<{ id: number; legacy_authority_level: number }>) {
      roleIdByLevel.set(r.legacy_authority_level, r.id);
    }

    const staffRows = await querySqlcmdJson<{ ID: string; SN: number; SGR: number; N1L: string; NN: string; EX: boolean }>(
      legacy.server,
      legacy.gsDatabase,
      "SELECT RTRIM(ID) AS ID, SN, SGR, N1L, NN, CAST(EX AS BIT) AS EX FROM dbo.StaffCounterparty WHERE RTRIM(TP) = '0'",
    );
    const resetSalt = crypto.randomBytes(16).toString("hex");
    const lockedPlaceholderHash = `scrypt-reset-required:${resetSalt}:${crypto.scryptSync(crypto.randomBytes(24).toString("hex"), resetSalt, 32).toString("hex")}`;
    await execBatchUpsert(
      conn,
      "INSERT INTO staff (legacy_us, legacy_id, role_id, shop_id, display_name, password_hash, active) VALUES",
      7,
      staffRows.map((s) => {
        const numericUs = /^\d+$/.test(s.ID) ? Number(s.ID) : null;
        return [
          numericUs,
          clampStr(s.ID, 32),
          roleIdByLevel.get(Number(s.SGR ?? 1)) ?? roleIdByLevel.get(1)!,
          shopIdBySn.get(s.SN) ?? shopIdBySn.get(1)!,
          clampStr(s.N1L || s.NN || `Staff ${s.ID}`, 120),
          lockedPlaceholderHash,
          s.EX ? 0 : 1,
        ];
      }),
      "ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = VALUES(active)",
    );
    const [staffDbRows] = await conn.query("SELECT id, legacy_us FROM staff WHERE legacy_us IS NOT NULL");
    const staffIdByUs = new Map<number, number>();
    for (const r of staffDbRows as Array<{ id: number; legacy_us: number }>) {
      staffIdByUs.set(r.legacy_us, r.id);
    }

    // 5. Customer Grades, Customers (2,302), Member Cards (108), CRM Rules (3), Suppliers (76)
    const gradeRows = await querySqlcmdJson<{ KY: number; zh: string; en: string }>(
      legacy.server,
      legacy.gsDatabase,
      "SELECT KY, dbo.Encrypt(D1L, 0) AS zh, dbo.Encrypt(D2L, 0) AS en FROM dbo.CustomerData WHERE dbo.Encrypt(TP, 0) = N'CustGrade' AND SN = 0",
    );
    await execBatchUpsert(
      conn,
      "INSERT INTO customer_grades (legacy_code, name_zh, name_en) VALUES",
      3,
      gradeRows.map((g) => [g.KY, clampStr(g.zh, 80) || `Grade ${g.KY}`, clampStr(g.en, 80) || `Grade ${g.KY}`]),
      "ON DUPLICATE KEY UPDATE name_zh = VALUES(name_zh), name_en = VALUES(name_en)",
    );
    const [gradeDbRows] = await conn.query("SELECT id, legacy_code FROM customer_grades");
    const gradeIdByCode = new Map<number, number>();
    for (const r of gradeDbRows as Array<{ id: number; legacy_code: number }>) {
      gradeIdByCode.set(r.legacy_code, r.id);
    }

    const custRows = await querySqlcmdJson<{
      ID: string;
      SGR: number | null;
      N1L: string | null;
      N2L: string | null;
      NN: string | null;
      TL1: string | null;
      EM: string | null;
      BPT1: number | null;
      EX: boolean;
    }>(
      legacy.server,
      legacy.gsDatabase,
      "SELECT RTRIM(S.ID) AS ID, S.SGR, S.N1L, S.N2L, S.NN, S.TL1, S.EM, S.BPT1, CAST(S.EX AS BIT) AS EX FROM dbo.StaffCounterparty S WHERE RTRIM(S.TP) = '2'",
    );
    await execBatchUpsert(
      conn,
      "INSERT INTO customers (legacy_id, grade_id, name_zh, name_en, phone, email, points_balance, active) VALUES",
      8,
      custRows.map((c) => [
        clampStr(c.ID, 32),
        c.SGR !== null ? (gradeIdByCode.get(Number(c.SGR)) ?? null) : null,
        clampStr(c.N1L || c.NN || c.ID, 160),
        clampStr(c.N2L || "", 160),
        clampStr(c.TL1 || "", 40),
        clampStr(c.EM || "", 160),
        Math.round(Number(c.BPT1 ?? 0)),
        c.EX ? 0 : 1,
      ]),
      "ON DUPLICATE KEY UPDATE points_balance = VALUES(points_balance), active = VALUES(active)",
    );
    const [custDbRows] = await conn.query("SELECT id, legacy_id FROM customers");
    const customerIdByLegacyId = new Map<string, number>();
    for (const r of custDbRows as Array<{ id: number; legacy_id: string }>) {
      customerIdByLegacyId.set(r.legacy_id, r.id);
    }

    const rwCardRows = await querySqlcmdJson<{ ID: number; SCID: string | null; STS: number }>(
      legacy.server,
      legacy.gsDatabase,
      "SELECT ID, RTRIM(SCID) AS SCID, STS FROM dbo.RWCards",
    );
    const validRwCards = rwCardRows.filter((r) => r.SCID && customerIdByLegacyId.has(r.SCID));
    await execBatchUpsert(
      conn,
      "INSERT INTO member_cards (customer_id, card_no, active) VALUES",
      3,
      validRwCards.map((r) => [customerIdByLegacyId.get(r.SCID!)!, String(r.ID), r.STS === 1 ? 1 : 0]),
      "ON DUPLICATE KEY UPDATE active = VALUES(active)",
    );

    const crmRows = await querySqlcmdJson<{
      RID: number;
      RULENAME: string;
      D2L: string | null;
      ACTTYPE: number;
      ENABLED: boolean;
      PRIORITY: number;
    }>(
      legacy.server,
      legacy.gsDatabase,
      "SELECT RID, RULENAME, D2L, ACTTYPE, CAST(ENABLED AS BIT) AS ENABLED, PRIORITY FROM dbo.CRMRule",
    );
    await execBatchUpsert(
      conn,
      "INSERT INTO crm_rules (legacy_rid, rule_name, description_en, action_type, enabled, priority) VALUES",
      6,
      crmRows.map((r) => [
        r.RID,
        clampStr(r.RULENAME, 120),
        clampStr(r.D2L || r.RULENAME, 255),
        r.ACTTYPE,
        r.ENABLED ? 1 : 0,
        r.PRIORITY,
      ]),
      "ON DUPLICATE KEY UPDATE rule_name = VALUES(rule_name), enabled = VALUES(enabled)",
    );

    const supRows = await querySqlcmdJson<{ ID: string; N1L: string | null; N2L: string | null; TL1: string | null; EX: boolean }>(
      legacy.server,
      legacy.gsDatabase,
      "SELECT RTRIM(ID) AS ID, N1L, N2L, TL1, CAST(EX AS BIT) AS EX FROM dbo.StaffCounterparty WHERE RTRIM(TP) = '1'",
    );
    await execBatchUpsert(
      conn,
      "INSERT INTO suppliers (legacy_id, name_zh, name_en, phone, active) VALUES",
      5,
      supRows.map((s) => [
        clampStr(s.ID, 32),
        clampStr(s.N1L || s.ID, 160),
        clampStr(s.N2L || "", 160),
        clampStr(s.TL1 || "", 40),
        s.EX ? 0 : 1,
      ]),
      "ON DUPLICATE KEY UPDATE name_zh = VALUES(name_zh), active = VALUES(active)",
    );

    // 6. Products (1,983) + Stock Balances (1,948)
    const bonusIgnoreRows = await querySqlcmdJson<{ D1L: string }>(
      legacy.server,
      legacy.gsDatabase,
      "SELECT RTRIM(D1L) AS D1L FROM dbo.CustomerSetting WHERE TP = 'ProductBonusIgnore' AND D2L = '1'",
    );
    const bonusIgnoreSet = new Set(bonusIgnoreRows.map((r) => r.D1L));

    const prodRows = await querySqlcmdJson<{
      SN: number;
      BC: string;
      UBC: string | null;
      PN1L: string | null;
      PN2L: string | null;
      C1: number;
      UN: number;
      SEP: number | null;
      FP: boolean;
      LP: number | null;
      AVPP: number | null;
      ED: number;
    }>(
      legacy.server,
      legacy.gsDatabase,
      "SELECT SN, RTRIM(BC) AS BC, RTRIM(ISNULL(UBC,'')) AS UBC, PN1L, PN2L, C1, UN, SEP, CAST(FP AS BIT) AS FP, LP, AVPP, ED FROM dbo.ProductOnSale",
    );
    await execBatchUpsert(
      conn,
      "INSERT INTO products (shop_id, barcode, ubc, name_zh, name_en, category_id, legacy_c1, unit_id, sell_price, fixed_price, last_purchase_cost, avg_cost, allow_item_discount, exclude_from_crm_bonus, active) VALUES",
      15,
      prodRows.map((p) => {
        const sep = toDec4(p.SEP);
        return [
          shopIdBySn.get(p.SN) ?? shopIdBySn.get(0)!,
          clampStr(p.BC, 40),
          clampStr(p.UBC, 40),
          clampStr(p.PN1L || p.BC, 200),
          clampStr(p.PN2L || "", 200),
          categoryIdByC1.get(p.C1) ?? null,
          p.C1,
          unitIdByUn.get(p.UN) ?? null,
          sep,
          p.FP ? sep : null,
          toDec4(p.LP),
          toDec4(p.AVPP),
          1,
          bonusIgnoreSet.has(p.BC) ? 1 : 0,
          1,
        ];
      }),
      "ON DUPLICATE KEY UPDATE name_zh = VALUES(name_zh), name_en = VALUES(name_en), sell_price = VALUES(sell_price), avg_cost = VALUES(avg_cost)",
    );

    const [prodDbRows] = await conn.query("SELECT id, barcode FROM products");
    const productIdByBc = new Map<string, number>();
    for (const r of prodDbRows as Array<{ id: number; barcode: string }>) {
      productIdByBc.set(r.barcode, r.id);
    }

    const stockRows = await querySqlcmdJson<{ SN: number; BC: string; ST: number | null; PP: number | null }>(
      legacy.server,
      legacy.gxDatabase,
      "SELECT SN, RTRIM(BC) AS BC, ST, PP FROM dbo.StockDetailBD",
    );
    const validStockRows = stockRows.filter((s) => productIdByBc.has(s.BC) && shopIdBySn.has(s.SN));
    await execBatchUpsert(
      conn,
      "INSERT INTO stock_balances (shop_id, product_id, on_hand_qty, moving_avg_cost) VALUES",
      4,
      validStockRows.map((s) => [shopIdBySn.get(s.SN)!, productIdByBc.get(s.BC)!, toDec4(s.ST), toDec4(s.PP)]),
      "ON DUPLICATE KEY UPDATE on_hand_qty = VALUES(on_hand_qty), moving_avg_cost = VALUES(moving_avg_cost)",
    );

    // 6b. POS Menu Groups & Buttons (390 rows across BBG groups)
    const menuRows = await querySqlcmdJson<{
      SN: number;
      BBG: number;
      grid_pos: number;
      BC: string;
      BLA1L: string | null;
      BLA2L: string | null;
      COLOR: string | null;
      PN1L: string | null;
      PN2L: string | null;
    }>(
      legacy.server,
      legacy.gsDatabase,
      `SELECT M.SN, M.BBG,
              ROW_NUMBER() OVER (PARTITION BY M.BBG ORDER BY M.SN, M.BLI, M.FT) AS grid_pos,
              RTRIM(M.BC) AS BC, M.BLA1L, M.BLA2L, M.COLOR, P.PN1L, P.PN2L
       FROM dbo.Menu M
       LEFT JOIN dbo.ProductOnSale P ON RTRIM(P.BC) = RTRIM(M.BC)
       ORDER BY M.BBG, grid_pos`,
    );
    const activeShopId = shopIdBySn.get(1) ?? shopIdBySn.get(0)!;
    const uniqueBbgs = Array.from(new Set(menuRows.map((m) => m.BBG))).sort((a, b) => a - b);
    await execBatchUpsert(
      conn,
      "INSERT INTO pos_menus (shop_id, code, title_zh, title_en, sort_order) VALUES",
      5,
      uniqueBbgs.map((bbg) => [activeShopId, `BBG_${bbg}`, `菜單組 ${bbg}`, `Menu Group ${bbg}`, bbg]),
      "ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)",
    );
    const [menuDbRows] = await conn.query("SELECT id, code FROM pos_menus WHERE shop_id = ?", [activeShopId]);
    const menuIdByCode = new Map<string, number>();
    for (const r of menuDbRows as Array<{ id: number; code: string }>) {
      menuIdByCode.set(r.code, r.id);
    }
    await conn.query("DELETE FROM pos_menu_buttons");
    await execBatchUpsert(
      conn,
      "INSERT INTO pos_menu_buttons (menu_id, product_id, label_zh, label_en, grid_position, color_hex) VALUES",
      6,
      menuRows.map((m) => [
        menuIdByCode.get(`BBG_${m.BBG}`)!,
        productIdByBc.get(clampStr(m.BC, 40)) ?? null,
        clampStr(m.BLA1L || m.PN1L || m.BC, 80),
        clampStr(m.BLA2L || m.PN2L || m.PN1L || m.BC, 80),
        m.grid_pos,
        clampStr(m.COLOR, 16) || null,
      ]),
      "ON DUPLICATE KEY UPDATE product_id = VALUES(product_id), label_zh = VALUES(label_zh), label_en = VALUES(label_en)",
    );

    // 7. Bills (56,102 HistHeader + 1,987 OfficeXHeader-only = 58,089 unique)
    interface RawBillRow {
      RL: string;
      SN: number;
      MN: number;
      XC: number;
      XT: number;
      SD: number;
      CF: boolean;
      BD: string;
      HK: string;
      GA: number;
      NA: number;
      SC: string | null;
      US: number | null;
      RE: string | null;
      paid_pa: number | null;
      max_pd: string | null;
    }

    async function migrateBillTable(tableName: "HistHeader" | "OfficeXHeader", whereExtra: string) {
      let lastRl = "";
      let count = 0;
      while (true) {
        const escapedLast = lastRl.replace(/'/g, "''");
        const chunk = await querySqlcmdJson<RawBillRow>(
          legacy.server,
          legacy.gxDatabase,
          `SELECT TOP 4000
            H.RL,
            H.SN,
            H.MN,
            H.XC,
            H.XT,
            H.SD,
            CAST(H.CF AS BIT) AS CF,
            CONVERT(VARCHAR(10), H.BD, 120) AS BD,
            CONVERT(VARCHAR(19), H.HK, 120) AS HK,
            CAST(ISNULL(H.GA, 0) AS DECIMAL(18,4)) AS GA,
            CAST(ISNULL(H.NA, 0) AS DECIMAL(18,4)) AS NA,
            RTRIM(ISNULL(H.SC, '')) AS SC,
            H.US,
            H.RE,
            P.paid_pa,
            P.max_pd
          FROM dbo.${tableName} H
          OUTER APPLY (
            SELECT CAST(ISNULL(SUM(PA), 0) AS DECIMAL(18,4)) AS paid_pa,
                   CONVERT(VARCHAR(19), MAX(PD), 120) AS max_pd
            FROM dbo.HistPayment PM
            WHERE PM.RL = H.RL AND PM.CA = 0 AND PM.PM <> 8
          ) P
          WHERE H.RL > '${escapedLast}' ${whereExtra}
          ORDER BY H.RL`,
        );
        if (chunk.length === 0) break;

        await execBatchUpsert(
          conn,
          "INSERT INTO bills (legacy_rl, shop_id, terminal_id, staff_id, customer_id, invoice_no, doc_type, source_table, legacy_sc, legacy_xc, legacy_xt, legacy_sd, status, payment_status, business_date, gross_amount, discount_amount, net_amount, paid_amount, balance_due, issued_at, paid_at, notes) VALUES",
          23,
          chunk.map((b) => {
            const rl = clampStr(b.RL, 32);
            const ar = classifyLegacyInvoiceArState({
              netAmountHkd: Number(b.NA ?? 0),
              nonDlybalPaidHkd: Number(b.paid_pa ?? 0),
              cancelled: b.CF,
            });
            const ga = Number(b.GA ?? 0);
            const na = Number(b.NA ?? 0);
            const disc = Math.max(0, ga - na);
            const sc = clampStr(b.SC, 32);
            return [
              rl,
              shopIdBySn.get(b.SN) ?? shopIdBySn.get(1)!,
              termIdBySnMn.get(`${b.SN}:${b.MN}`) ?? termIdBySnMn.get("1:1")!,
              b.US !== null ? (staffIdByUs.get(b.US) ?? null) : null,
              sc && customerIdByLegacyId.has(sc) ? customerIdByLegacyId.get(sc)! : null,
              rl,
              mapXcToDocType(b.XC),
              tableName,
              sc || null,
              b.XC,
              b.XT,
              b.SD,
              b.CF ? "cancelled" : "completed",
              ar.paymentStatus,
              b.BD,
              toDec4(ga),
              toDec4(disc),
              toDec4(na),
              toDec4(ar.paidAmountHkd),
              toDec4(ar.balanceDueHkd),
              b.HK,
              ar.paymentStatus === "paid" ? (b.max_pd ?? b.HK) : null,
              clampStr(b.RE, 500) || null,
            ];
          }),
          "ON DUPLICATE KEY UPDATE payment_status = VALUES(payment_status), paid_amount = VALUES(paid_amount), balance_due = VALUES(balance_due), paid_at = VALUES(paid_at)",
        );

        count += chunk.length;
        lastRl = chunk[chunk.length - 1]!.RL;
      }
      return count;
    }

    const histHeaderCount = await migrateBillTable("HistHeader", "");
    const officeOnlyCount = await migrateBillTable(
      "OfficeXHeader",
      "AND NOT EXISTS (SELECT 1 FROM dbo.HistHeader HH WHERE HH.RL = H.RL)",
    );

    const [billDbRows] = await conn.query("SELECT id, legacy_rl FROM bills WHERE legacy_rl IS NOT NULL");
    const billIdByRl = new Map<string, number>();
    for (const r of billDbRows as Array<{ id: number; legacy_rl: string }>) {
      billIdByRl.set(r.legacy_rl, r.id);
    }

    // 8. Bill Lines (254,292 HistDetail + 12,805 OfficeXDetail = 267,097 lines)
    interface RawDetailRow {
      RL: string;
      line_seq: number;
      DK: number;
      BC: string | null;
      PN1L: string | null;
      PN2L: string | null;
      C1: number;
      QU: number;
      UP: number;
      DP: number;
      DA: number;
      TA: number;
      CA: boolean;
      OFG: boolean;
    }

    async function migrateDetailByHeaderList(
      headerSql: string,
      detailTable: "HistDetail" | "OfficeXDetail",
    ) {
      const headers = await querySqlcmdJson<{ RL: string }>(legacy.server, legacy.gxDatabase, headerSql);
      let migrated = 0;
      const BATCH_HEADERS = 1000;
      for (let i = 0; i < headers.length; i += BATCH_HEADERS) {
        const firstRl = headers[i]!.RL.replace(/'/g, "''");
        const lastRl = headers[Math.min(i + BATCH_HEADERS - 1, headers.length - 1)]!.RL.replace(/'/g, "''");

        const detailRows = await querySqlcmdJson<RawDetailRow>(
          legacy.server,
          legacy.gxDatabase,
          `SELECT
            RTRIM(D.RL) AS RL,
            ROW_NUMBER() OVER (PARTITION BY D.RL ORDER BY D.DK, D.LN, D.GN) AS line_seq,
            D.DK,
            RTRIM(ISNULL(D.BC, '')) AS BC,
            D.PN1L,
            D.PN2L,
            D.C1,
            CAST(ISNULL(D.QU, 0) AS DECIMAL(18,4)) AS QU,
            CAST(ISNULL(D.UP, 0) AS DECIMAL(18,4)) AS UP,
            CAST(ISNULL(D.DP, 0) AS DECIMAL(18,6)) AS DP,
            CAST(ISNULL(D.DA, 0) AS DECIMAL(18,4)) AS DA,
            CAST(ISNULL(D.TA, 0) AS DECIMAL(18,4)) AS TA,
            CAST(ISNULL(D.CA, 0) AS BIT) AS CA,
            CAST(ISNULL(D.OFG, 0) AS BIT) AS OFG
          FROM dbo.${detailTable} D
          WHERE D.RL >= '${firstRl}' AND D.RL <= '${lastRl}'`,
          120_000,
        );

        const filtered = detailRows.filter((d) => billIdByRl.has(d.RL));
        await execBatchUpsert(
          conn,
          "INSERT INTO bill_lines (bill_id, line_no, product_id, sku, name_zh, name_en, category_c1, legacy_dk, quantity, unit_price, discount_rate, line_discount_amount, line_total, cancelled, is_modifier) VALUES",
          15,
          filtered.map((d) => {
            const sku = clampStr(d.BC, 40) || "UNKNOWN";
            return [
              billIdByRl.get(d.RL)!,
              d.line_seq,
              productIdByBc.get(sku) ?? null,
              sku,
              clampStr(d.PN1L || sku, 200),
              clampStr(d.PN2L || "", 200),
              Number(d.C1 ?? 0),
              d.DK,
              toDec4(d.QU),
              toDec4(d.UP),
              toDec6(d.DP),
              toDec4(d.DA),
              toDec4(d.TA),
              d.CA ? 1 : 0,
              d.OFG ? 1 : 0,
            ];
          }),
          "ON DUPLICATE KEY UPDATE line_total = VALUES(line_total), cancelled = VALUES(cancelled)",
        );
        migrated += filtered.length;
      }
      return migrated;
    }

    const histDetailCount = await migrateDetailByHeaderList(
      "SELECT RL FROM dbo.HistHeader ORDER BY RL",
      "HistDetail",
    );
    const officeDetailCount = await migrateDetailByHeaderList(
      "SELECT O.RL FROM dbo.OfficeXHeader O WHERE NOT EXISTS (SELECT 1 FROM dbo.HistHeader H WHERE H.RL = O.RL) ORDER BY O.RL",
      "OfficeXDetail",
    );

    // 9. Bill Payments (HistPayment WHERE PM <> 8 => 28,375 rows; PM=3 -> MASTERCARD)
    interface RawPaymentRow {
      RL: string;
      PK: number;
      PM: number;
      PA: number;
      TIPS: number;
      BD_STR: string;
      PD_STR: string;
      CA: boolean;
      APPC: string | null;
      RMM: string | null;
      US: number | null;
    }

    const paymentHeaders = await querySqlcmdJson<{ RL: string }>(
      legacy.server,
      legacy.gxDatabase,
      "SELECT DISTINCT RL FROM dbo.HistPayment WHERE PM <> 8 ORDER BY RL",
    );
    let paymentCount = 0;
    for (let i = 0; i < paymentHeaders.length; i += 2000) {
      const firstRl = paymentHeaders[i]!.RL.replace(/'/g, "''");
      const lastRl = paymentHeaders[Math.min(i + 1999, paymentHeaders.length - 1)]!.RL.replace(/'/g, "''");
      const pmRows = await querySqlcmdJson<RawPaymentRow>(
        legacy.server,
        legacy.gxDatabase,
        `SELECT
          RTRIM(RL) AS RL,
          PK,
          PM,
          CAST(ISNULL(PA, 0) AS DECIMAL(18,4)) AS PA,
          CAST(ISNULL(TIPS, 0) AS DECIMAL(18,4)) AS TIPS,
          CONVERT(VARCHAR(10), ISNULL(BSD, PD), 120) AS BD_STR,
          CONVERT(VARCHAR(19), PD, 120) AS PD_STR,
          CAST(ISNULL(CA, 0) AS BIT) AS CA,
          APPC,
          RMM,
          US
        FROM dbo.HistPayment
        WHERE PM <> 8 AND RL >= '${firstRl}' AND RL <= '${lastRl}'`,
      );

      const validPmts = pmRows.filter((p) => billIdByRl.has(p.RL) && payMethodIdByPm.has(p.PM));
      await execBatchUpsert(
        conn,
        "INSERT INTO bill_payments (bill_id, pay_method_id, legacy_pk, staff_id, tender_code, amount, tips_amount, paid_at, business_date, approval_code, remarks, voided) VALUES",
        12,
        validPmts.map((p) => {
          const mapped = LEGACY_PAY_METHOD_MAP[p.PM]!;
          return [
            billIdByRl.get(p.RL)!,
            payMethodIdByPm.get(p.PM)!,
            p.PK,
            p.US !== null ? (staffIdByUs.get(p.US) ?? null) : null,
            mapped.tenderCode!,
            toDec4(p.PA),
            toDec4(p.TIPS),
            p.PD_STR,
            p.BD_STR,
            clampStr(p.APPC, 16) || null,
            clampStr(p.RMM, 255) || null,
            p.CA ? 1 : 0,
          ];
        }),
        "ON DUPLICATE KEY UPDATE amount = VALUES(amount), voided = VALUES(voided), tender_code = VALUES(tender_code)",
      );
      paymentCount += validPmts.length;
    }

    // 10. Day-End Batches (3,132)
    const batchRows = await querySqlcmdJson<{
      SN: number;
      MN: number;
      BK: string;
      BNO: number;
      BD_STR: string;
      TB: number;
      CL: boolean;
      CLDT_STR: string | null;
    }>(
      legacy.server,
      legacy.gxDatabase,
      `SELECT SN, MN, RTRIM(BK) AS BK, BNO, CONVERT(VARCHAR(10), BD, 120) AS BD_STR,
              CAST(ISNULL(TB, 0) AS DECIMAL(18,4)) AS TB, CAST(ISNULL(CL, 0) AS BIT) AS CL,
              CONVERT(VARCHAR(19), CLDT, 120) AS CLDT_STR
       FROM dbo.BatchHeader`,
    );
    await execBatchUpsert(
      conn,
      "INSERT INTO day_end_batches (legacy_bk, shop_id, terminal_id, business_date, batch_no, status, issued_sales_total, collected_payments_total, closed, closed_at) VALUES",
      10,
      batchRows.map((b) => [
        clampStr(b.BK, 32),
        shopIdBySn.get(b.SN) ?? shopIdBySn.get(1)!,
        termIdBySnMn.get(`${b.SN}:${b.MN}`) ?? termIdBySnMn.get("1:1")!,
        b.BD_STR,
        b.BNO,
        b.CL ? "closed" : "open",
        toDec4(b.TB),
        toDec4(b.TB),
        b.CL ? 1 : 0,
        b.CLDT_STR,
      ]),
      "ON DUPLICATE KEY UPDATE status = VALUES(status), closed = VALUES(closed)",
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          elapsedMs: Date.now() - t0,
          migratedCounts: {
            shops: shopMap.size,
            terminals: distinctTermRows.length,
            payMethods: activePms.length,
            categories: catMap.size,
            units: unitMap.size,
            staff: staffRows.length,
            customers: custRows.length,
            memberCards: validRwCards.length,
            crmRules: crmRows.length,
            suppliers: supRows.length,
            products: prodRows.length,
            stockBalances: validStockRows.length,
            posMenus: uniqueBbgs.length,
            posMenuButtons: menuRows.length,
            billsFromHistHeader: histHeaderCount,
            billsFromOfficeXOnly: officeOnlyCount,
            billLinesFromHistDetail: histDetailCount,
            billLinesFromOfficeXOnly: officeDetailCount,
            billPaymentsExclDlybal: paymentCount,
            dayEndBatches: batchRows.length,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("V47 -> MySQL ETL failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
