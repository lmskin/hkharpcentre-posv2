import mysql, { type Connection } from "mysql2/promise";
import { loadRootDotEnv } from "./env";

export interface DbSnapshot {
  maxIds: {
    bills: number;
    billLines: number;
    billPayments: number;
    auditLogs: number;
    stockBalances: number;
    stockMovements: number;
    stockTakes: number;
    stockTakeLines: number;
    crmPointLedger: number;
    dayEndBatches: number;
    dayEndTenderCounts: number;
    deliveryOrders: number;
    pettyCashVouchers: number;
    octopusTransactions: number;
    octopusSettlements: number;
    products: number;
    customers: number;
    memberCards: number;
    suppliers: number;
    appSettings: number;
    billSequences: number;
  };
  sequences: Array<{ id: number; nextSeq: number }>;
  staffCreds: Array<{ id: number; legacyId: string; passwordHash: string; pinHash: string | null }>;
  appSettingsRows: Array<{ id: number; settingValue: string }>;
  customers: Array<{
    id: number;
    gradeId: number | null;
    nameZh: string;
    nameEn: string;
    phone: string;
    email: string;
    pointsBalance: number;
  }>;
  memberCards: Array<{
    id: number;
    customerId: number;
    cardNo: string;
    active: number;
  }>;
  suppliers: Array<{
    id: number;
    legacyId: string;
    nameZh: string;
    nameEn: string;
    phone: string;
    active: number;
  }>;
  products: Array<{
    id: number;
    ubc: string;
    nameZh: string;
    nameEn: string;
    legacyC1: number;
    sellPrice: string;
    fixedPrice: string | null;
    lastPurchaseCost: string;
    avgCost: string;
    allowItemDiscount: number;
    excludeFromCrmBonus: number;
  }>;
  stockBalances: Array<{
    id: number;
    onHandQty: string;
    movingAvgCost: string;
  }>;
}

export async function openE2eMysqlConnection(): Promise<Connection> {
  loadRootDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not found in .env");
  return mysql.createConnection({ uri: url, timezone: "+08:00" });
}

async function maxId(conn: Connection, table: string): Promise<number> {
  const [rows] = await conn.query(`SELECT COALESCE(MAX(id), 0) AS m FROM \`${table}\``);
  return Number((rows as Array<{ m: number }>)[0]?.m ?? 0);
}

export async function captureDbSnapshot(conn: Connection): Promise<DbSnapshot> {
  const [
    bills,
    billLines,
    billPayments,
    auditLogs,
    stockBalances,
    stockMovements,
    stockTakes,
    stockTakeLines,
    crmPointLedger,
    dayEndBatches,
    dayEndTenderCounts,
    deliveryOrders,
    pettyCashVouchers,
    octopusTransactions,
    octopusSettlements,
    products,
    customers,
    memberCards,
    suppliers,
    appSettings,
    billSequences,
  ] = await Promise.all([
    maxId(conn, "bills"),
    maxId(conn, "bill_lines"),
    maxId(conn, "bill_payments"),
    maxId(conn, "audit_logs"),
    maxId(conn, "stock_balances"),
    maxId(conn, "stock_movements"),
    maxId(conn, "stock_takes"),
    maxId(conn, "stock_take_lines"),
    maxId(conn, "crm_point_ledger"),
    maxId(conn, "day_end_batches"),
    maxId(conn, "day_end_tender_counts"),
    maxId(conn, "delivery_orders"),
    maxId(conn, "petty_cash_vouchers"),
    maxId(conn, "octopus_transactions"),
    maxId(conn, "octopus_settlements"),
    maxId(conn, "products"),
    maxId(conn, "customers"),
    maxId(conn, "member_cards"),
    maxId(conn, "suppliers"),
    maxId(conn, "app_settings"),
    maxId(conn, "bill_sequences"),
  ]);

  const [seqRows] = await conn.query("SELECT id, next_seq FROM bill_sequences");
  const [staffRows] = await conn.query(
    "SELECT id, legacy_id, password_hash, pin_hash FROM staff WHERE legacy_id IN ('5002', '101')",
  );
  const [settingRows] = await conn.query(
    "SELECT id, CAST(setting_value AS CHAR) AS setting_value FROM app_settings",
  );
  const [custRows] = await conn.query(
    "SELECT id, grade_id, name_zh, name_en, phone, email, points_balance FROM customers",
  );
  const [cardRows] = await conn.query(
    "SELECT id, customer_id, card_no, active FROM member_cards",
  );
  const [supRows] = await conn.query(
    "SELECT id, legacy_id, name_zh, name_en, phone, active FROM suppliers",
  );
  const [prodRows] = await conn.query(
    "SELECT id, ubc, name_zh, name_en, legacy_c1, sell_price, fixed_price, last_purchase_cost, avg_cost, allow_item_discount, exclude_from_crm_bonus FROM products",
  );
  const [balRows] = await conn.query("SELECT id, on_hand_qty, moving_avg_cost FROM stock_balances");

  return {
    maxIds: {
      bills,
      billLines,
      billPayments,
      auditLogs,
      stockBalances,
      stockMovements,
      stockTakes,
      stockTakeLines,
      crmPointLedger,
      dayEndBatches,
      dayEndTenderCounts,
      deliveryOrders,
      pettyCashVouchers,
      octopusTransactions,
      octopusSettlements,
      products,
      customers,
      memberCards,
      suppliers,
      appSettings,
      billSequences,
    },
    sequences: (seqRows as Array<{ id: number; next_seq: number }>).map((r) => ({
      id: r.id,
      nextSeq: r.next_seq,
    })),
    staffCreds: (
      staffRows as Array<{ id: number; legacy_id: string; password_hash: string; pin_hash: string | null }>
    ).map((r) => ({
      id: r.id,
      legacyId: r.legacy_id,
      passwordHash: r.password_hash,
      pinHash: r.pin_hash,
    })),
    appSettingsRows: (settingRows as Array<{ id: number; setting_value: string }>).map((r) => ({
      id: r.id,
      settingValue: r.setting_value,
    })),
    customers: (
      custRows as Array<{
        id: number;
        grade_id: number | null;
        name_zh: string;
        name_en: string;
        phone: string;
        email: string;
        points_balance: number;
      }>
    ).map((r) => ({
      id: r.id,
      gradeId: r.grade_id,
      nameZh: r.name_zh,
      nameEn: r.name_en,
      phone: r.phone,
      email: r.email,
      pointsBalance: r.points_balance,
    })),
    memberCards: (
      cardRows as Array<{
        id: number;
        customer_id: number;
        card_no: string;
        active: number;
      }>
    ).map((r) => ({
      id: r.id,
      customerId: r.customer_id,
      cardNo: r.card_no,
      active: Number(r.active),
    })),
    suppliers: (
      supRows as Array<{
        id: number;
        legacy_id: string;
        name_zh: string;
        name_en: string;
        phone: string;
        active: number;
      }>
    ).map((r) => ({
      id: r.id,
      legacyId: r.legacy_id,
      nameZh: r.name_zh,
      nameEn: r.name_en,
      phone: r.phone,
      active: Number(r.active),
    })),
    products: (
      prodRows as Array<{
        id: number;
        ubc: string;
        name_zh: string;
        name_en: string;
        legacy_c1: number;
        sell_price: string;
        fixed_price: string | null;
        last_purchase_cost: string;
        avg_cost: string;
        allow_item_discount: number;
        exclude_from_crm_bonus: number;
      }>
    ).map((r) => ({
      id: r.id,
      ubc: r.ubc,
      nameZh: r.name_zh,
      nameEn: r.name_en,
      legacyC1: r.legacy_c1,
      sellPrice: r.sell_price,
      fixedPrice: r.fixed_price,
      lastPurchaseCost: r.last_purchase_cost,
      avgCost: r.avg_cost,
      allowItemDiscount: Number(r.allow_item_discount),
      excludeFromCrmBonus: Number(r.exclude_from_crm_bonus),
    })),
    stockBalances: (balRows as Array<{ id: number; on_hand_qty: string; moving_avg_cost: string }>).map((r) => ({
      id: r.id,
      onHandQty: r.on_hand_qty,
      movingAvgCost: r.moving_avg_cost,
    })),
  };
}

export async function restoreDbSnapshot(conn: Connection, snap: DbSnapshot): Promise<void> {
  const m = snap.maxIds;

  await conn.query("DELETE FROM octopus_settlements WHERE id > ?", [m.octopusSettlements]);
  await conn.query("DELETE FROM octopus_transactions WHERE id > ? OR bill_id > ?", [
    m.octopusTransactions,
    m.bills,
  ]);
  await conn.query("DELETE FROM petty_cash_vouchers WHERE id > ? OR bill_id > ?", [
    m.pettyCashVouchers,
    m.bills,
  ]);
  await conn.query("DELETE FROM delivery_orders WHERE id > ? OR bill_id > ?", [m.deliveryOrders, m.bills]);
  await conn.query("DELETE FROM stock_movements WHERE id > ? OR bill_id > ?", [m.stockMovements, m.bills]);
  await conn.query("DELETE FROM stock_take_lines WHERE id > ? OR stock_take_id > ?", [
    m.stockTakeLines,
    m.stockTakes,
  ]);
  await conn.query("DELETE FROM stock_takes WHERE id > ?", [m.stockTakes]);
  await conn.query("DELETE FROM crm_point_ledger WHERE id > ? OR bill_id > ?", [m.crmPointLedger, m.bills]);
  await conn.query("DELETE FROM day_end_tender_counts WHERE id > ? OR batch_id > ?", [
    m.dayEndTenderCounts,
    m.dayEndBatches,
  ]);
  await conn.query("DELETE FROM day_end_batches WHERE id > ? OR business_date = '2099-12-31'", [
    m.dayEndBatches,
  ]);
  await conn.query("DELETE FROM daily_hourly_sales WHERE business_date = '2099-12-31'");
  await conn.query("DELETE FROM bill_payments WHERE id > ? OR bill_id > ?", [m.billPayments, m.bills]);
  await conn.query("DELETE FROM bill_lines WHERE id > ? OR bill_id > ?", [m.billLines, m.bills]);
  await conn.query("DELETE FROM bills WHERE id > ?", [m.bills]);
  await conn.query("DELETE FROM audit_logs WHERE id > ?", [m.auditLogs]);

  await conn.query("DELETE FROM stock_balances WHERE id > ?", [m.stockBalances]);
  await conn.query("DELETE FROM products WHERE id > ?", [m.products]);
  await conn.query("DELETE FROM member_cards WHERE id > ?", [m.memberCards]);
  await conn.query("DELETE FROM customers WHERE id > ?", [m.customers]);
  await conn.query("DELETE FROM suppliers WHERE id > ?", [m.suppliers]);
  await conn.query("DELETE FROM app_settings WHERE id > ?", [m.appSettings]);
  await conn.query("DELETE FROM bill_sequences WHERE id > ?", [m.billSequences]);

  for (const seq of snap.sequences) {
    await conn.query("UPDATE bill_sequences SET next_seq = ? WHERE id = ?", [seq.nextSeq, seq.id]);
  }
  for (const st of snap.staffCreds) {
    await conn.query("UPDATE staff SET password_hash = ?, pin_hash = ? WHERE id = ?", [
      st.passwordHash,
      st.pinHash,
      st.id,
    ]);
  }
  for (const s of snap.appSettingsRows) {
    await conn.query("UPDATE app_settings SET setting_value = CAST(? AS JSON) WHERE id = ?", [
      s.settingValue,
      s.id,
    ]);
  }

  // Restore any modified existing products, customers, member_cards, suppliers, or stock balances
  const [curProd] = await conn.query(
    "SELECT id, ubc, sell_price, fixed_price, last_purchase_cost, avg_cost, name_zh, name_en, legacy_c1, allow_item_discount, exclude_from_crm_bonus FROM products WHERE id <= ?",
    [m.products],
  );
  const snapProdMap = new Map(snap.products.map((p) => [p.id, p]));
  for (const row of curProd as Array<{
    id: number;
    ubc: string;
    sell_price: string;
    fixed_price: string | null;
    last_purchase_cost: string;
    avg_cost: string;
    name_zh: string;
    name_en: string;
    legacy_c1: number;
    allow_item_discount: number;
    exclude_from_crm_bonus: number;
  }>) {
    const orig = snapProdMap.get(row.id);
    if (
      orig &&
      (orig.ubc !== row.ubc ||
        orig.sellPrice !== row.sell_price ||
        orig.fixedPrice !== row.fixed_price ||
        orig.lastPurchaseCost !== row.last_purchase_cost ||
        orig.avgCost !== row.avg_cost ||
        orig.nameZh !== row.name_zh ||
        orig.nameEn !== row.name_en ||
        orig.legacyC1 !== row.legacy_c1 ||
        orig.allowItemDiscount !== Number(row.allow_item_discount) ||
        orig.excludeFromCrmBonus !== Number(row.exclude_from_crm_bonus))
    ) {
      await conn.query(
        "UPDATE products SET ubc=?, sell_price=?, fixed_price=?, last_purchase_cost=?, avg_cost=?, name_zh=?, name_en=?, legacy_c1=?, allow_item_discount=?, exclude_from_crm_bonus=? WHERE id=?",
        [
          orig.ubc,
          orig.sellPrice,
          orig.fixedPrice,
          orig.lastPurchaseCost,
          orig.avgCost,
          orig.nameZh,
          orig.nameEn,
          orig.legacyC1,
          orig.allowItemDiscount,
          orig.excludeFromCrmBonus,
          orig.id,
        ],
      );
    }
  }

  const [curCards] = await conn.query(
    "SELECT id, customer_id, card_no, active FROM member_cards WHERE id <= ?",
    [m.memberCards],
  );
  const snapCardMap = new Map(snap.memberCards.map((c) => [c.id, c]));
  for (const row of curCards as Array<{ id: number; customer_id: number; card_no: string; active: number }>) {
    const orig = snapCardMap.get(row.id);
    if (orig && (orig.customerId !== row.customer_id || orig.cardNo !== row.card_no || orig.active !== Number(row.active))) {
      await conn.query("UPDATE member_cards SET customer_id=?, card_no=?, active=? WHERE id=?", [
        orig.customerId,
        orig.cardNo,
        orig.active,
        orig.id,
      ]);
    }
  }

  const [curSup] = await conn.query(
    "SELECT id, legacy_id, name_zh, name_en, phone, active FROM suppliers WHERE id <= ?",
    [m.suppliers],
  );
  const snapSupMap = new Map(snap.suppliers.map((s) => [s.id, s]));
  for (const row of curSup as Array<{ id: number; legacy_id: string; name_zh: string; name_en: string; phone: string; active: number }>) {
    const orig = snapSupMap.get(row.id);
    if (
      orig &&
      (orig.legacyId !== row.legacy_id ||
        orig.nameZh !== row.name_zh ||
        orig.nameEn !== row.name_en ||
        orig.phone !== row.phone ||
        orig.active !== Number(row.active))
    ) {
      await conn.query("UPDATE suppliers SET legacy_id=?, name_zh=?, name_en=?, phone=?, active=? WHERE id=?", [
        orig.legacyId,
        orig.nameZh,
        orig.nameEn,
        orig.phone,
        orig.active,
        orig.id,
      ]);
    }
  }

  const [curCust] = await conn.query(
    "SELECT id, grade_id, name_zh, name_en, phone, email, points_balance FROM customers WHERE id <= ?",
    [m.customers],
  );
  const snapCustMap = new Map(snap.customers.map((c) => [c.id, c]));
  for (const row of curCust as Array<{
    id: number;
    grade_id: number | null;
    name_zh: string;
    name_en: string;
    phone: string;
    email: string;
    points_balance: number;
  }>) {
    const orig = snapCustMap.get(row.id);
    if (
      orig &&
      (orig.pointsBalance !== row.points_balance ||
        orig.gradeId !== row.grade_id ||
        orig.nameZh !== row.name_zh ||
        orig.nameEn !== row.name_en ||
        orig.phone !== row.phone ||
        orig.email !== row.email)
    ) {
      await conn.query(
        "UPDATE customers SET grade_id=?, name_zh=?, name_en=?, phone=?, email=?, points_balance=? WHERE id=?",
        [orig.gradeId, orig.nameZh, orig.nameEn, orig.phone, orig.email, orig.pointsBalance, orig.id],
      );
    }
  }

  const [curBal] = await conn.query(
    "SELECT id, on_hand_qty, moving_avg_cost FROM stock_balances WHERE id <= ?",
    [m.stockBalances],
  );
  const snapBalMap = new Map(snap.stockBalances.map((b) => [b.id, b]));
  for (const row of curBal as Array<{ id: number; on_hand_qty: string; moving_avg_cost: string }>) {
    const orig = snapBalMap.get(row.id);
    if (orig && (orig.onHandQty !== row.on_hand_qty || orig.movingAvgCost !== row.moving_avg_cost)) {
      await conn.query("UPDATE stock_balances SET on_hand_qty=?, moving_avg_cost=? WHERE id=?", [
        orig.onHandQty,
        orig.movingAvgCost,
        orig.id,
      ]);
    }
  }
}
