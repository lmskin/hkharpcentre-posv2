import type mysql from "mysql2/promise";
import { requireSharedDb, resolveActiveStoreContext } from "./queries";
import { formatHktBusinessDate } from "./transactions";

type SqlRow = mysql.RowDataPacket;

const SALES_DOC_TYPES_SQL = "'RETAIL_SALE', 'SALES_INVOICE', 'SALES_RETURN'";
const OFFICE_DOC_TYPES_SQL =
  "'GOODS_RECEIPT', 'PURCHASE_RETURN', 'STOCK_TRANSFER_OUT', 'STOCK_TRANSFER_IN', 'WRITE_OFF', 'STOCK_ADJUSTMENT', 'STOCKTAKE', 'PETTY_PAYOUT'";

const TENDER_LABELS: Readonly<Record<string, { zh: string; pm: number }>> = {
  CASH: { zh: "現金", pm: 0 },
  OCTOPUS: { zh: "八達通", pm: 1 },
  VISA: { zh: "Visa", pm: 2 },
  MASTERCARD: { zh: "Master", pm: 3 },
  UNIONPAY: { zh: "銀聯", pm: 4 },
  BANK_XFER: { zh: "Bank Transfer", pm: 5 },
  AMEX: { zh: "AE", pm: 6 },
  CHEQUE: { zh: "Cheque", pm: 7 },
};

const DOC_TYPE_META: Readonly<Record<string, { zh: string; xc: number }>> = {
  RETAIL_SALE: { zh: "零售銷售", xc: 99 },
  SALES_INVOICE: { zh: "發票銷售", xc: 23 },
  SALES_RETURN: { zh: "銷售退貨", xc: 9 },
  PETTY_PAYOUT: { zh: "門市支出 (Payout)", xc: 12 },
  GOODS_RECEIPT: { zh: "採購到貨", xc: 1 },
  PURCHASE_RETURN: { zh: "退貨供應商", xc: 4 },
  STOCK_TRANSFER_OUT: { zh: "倉庫轉出", xc: 13 },
  STOCK_TRANSFER_IN: { zh: "倉庫轉入", xc: 14 },
  WRITE_OFF: { zh: "貨品報銷", xc: 10 },
  STOCK_ADJUSTMENT: { zh: "存貨調整", xc: 15 },
  STOCKTAKE: { zh: "存貨盤點", xc: 93 },
  CRM_POINT_TXN: { zh: "會員積分調整", xc: 54 },
};

function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function round4(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

function emptyTenderBreakdown(): Record<string, number> {
  return {
    CASH: 0,
    OCTOPUS: 0,
    VISA: 0,
    MASTERCARD: 0,
    UNIONPAY: 0,
    BANK_XFER: 0,
    AMEX: 0,
    CHEQUE: 0,
  };
}

function shiftDateDays(ymd: string, deltaDays: number): string {
  const dt = new Date(`${ymd}T00:00:00+08:00`);
  dt.setTime(dt.getTime() + deltaDays * 86_400_000);
  return formatHktBusinessDate(dt);
}

export interface StoreReportMeta {
  shopId: number;
  legacySn: number;
  shopCode: string;
  shopNameZh: string;
  shopNameEn: string;
  printedAtIso: string;
  categories: Array<{ legacyC1: number; nameZh: string; nameEn: string }>;
}

/** Resolve active store metadata and product categories for report headers and filter pickers. */
export async function getStoreReportMeta(shopId?: number): Promise<StoreReportMeta> {
  const { pool } = requireSharedDb();
  const resolvedShopId = shopId ?? (await resolveActiveStoreContext()).shopId;
  const [[shopRows], [catRows]] = await Promise.all([
    pool.query<SqlRow[]>(
      "SELECT id, legacy_sn, code, name_zh, name_en FROM shops WHERE id = ? ORDER BY legacy_sn DESC LIMIT 1",
      [resolvedShopId],
    ),
    pool.query<SqlRow[]>(
      "SELECT legacy_c1, name_zh, name_en FROM categories ORDER BY legacy_c1 ASC",
    ),
  ]);
  const s = shopRows[0];
  return {
    shopId: s ? num(s.id) : resolvedShopId,
    legacySn: s ? num(s.legacy_sn) : 1,
    shopCode: str(s?.code || "01"),
    shopNameZh: str(s?.name_zh || "香港豎琴中心"),
    shopNameEn: str(s?.name_en || "Central"),
    printedAtIso: new Date().toISOString(),
    categories: catRows.map((c) => ({
      legacyC1: num(c.legacy_c1),
      nameZh: str(c.name_zh),
      nameEn: str(c.name_en),
    })),
  };
}

export interface HourlyReportRow {
  hourOfDay: number;
  billCount: number;
  grossSalesHkd: number;
  discountHkd: number;
  returnHkd: number;
  netSalesHkd: number;
  averageBillHkd: number;
  sharePct: number;
  byTender: Record<string, number>;
}

/** Legacy fmdhsales / dhsales 24-hour + 4 business-period + tender + void breakdown report. */
export async function getHourlySalesReport(businessDate: string, shopId: number) {
  const { pool } = requireSharedDb();
  const [billRows, pmtRows, voidRows, voidLineRows] = await Promise.all([
    pool.query<SqlRow[]>(
      `SELECT
        HOUR(b.issued_at) AS hr,
        COUNT(*) AS bill_count,
        COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -b.gross_amount ELSE b.gross_amount END), 0) AS gross_sales,
        COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -b.discount_amount ELSE b.discount_amount END), 0) AS discounts,
        COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN b.net_amount ELSE 0 END), 0) AS returns_amt,
        COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -b.net_amount ELSE b.net_amount END), 0) AS net_sales
      FROM bills b
      WHERE b.shop_id = ?
        AND b.business_date = ?
        AND b.status NOT IN ('cancelled', 'held')
        AND b.doc_type IN (${SALES_DOC_TYPES_SQL})
      GROUP BY HOUR(b.issued_at)
      ORDER BY hr ASC`,
      [shopId, businessDate],
    ),
    pool.query<SqlRow[]>(
      `SELECT
        HOUR(b.issued_at) AS hr,
        bp.tender_code,
        COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -bp.amount ELSE bp.amount END), 0) AS tender_amt
      FROM bill_payments bp
      INNER JOIN bills b ON b.id = bp.bill_id
      WHERE b.shop_id = ?
        AND b.business_date = ?
        AND b.status NOT IN ('cancelled', 'held')
        AND b.doc_type IN (${SALES_DOC_TYPES_SQL})
        AND bp.voided = 0
      GROUP BY HOUR(b.issued_at), bp.tender_code`,
      [shopId, businessDate],
    ),
    pool.query<SqlRow[]>(
      `SELECT
        COUNT(*) AS cancelled_bills,
        COALESCE(SUM(b.net_amount), 0) AS cancelled_amt
      FROM bills b
      WHERE b.shop_id = ?
        AND b.business_date = ?
        AND b.status = 'cancelled'
        AND b.doc_type IN (${SALES_DOC_TYPES_SQL})`,
      [shopId, businessDate],
    ),
    pool.query<SqlRow[]>(
      `SELECT COUNT(*) AS cancelled_lines
      FROM bill_lines bl
      INNER JOIN bills b ON b.id = bl.bill_id
      WHERE b.shop_id = ?
        AND b.business_date = ?
        AND b.doc_type IN (${SALES_DOC_TYPES_SQL})
        AND (b.status = 'cancelled' OR bl.cancelled = 1)`,
      [shopId, businessDate],
    ),
  ]);

  const byHour = new Map<number, SqlRow>();
  for (const r of billRows[0]) byHour.set(num(r.hr), r);

  const tenderByHour = new Map<number, Record<string, number>>();
  const tenderTotals = emptyTenderBreakdown();
  for (const r of pmtRows[0]) {
    const hr = num(r.hr);
    const code = str(r.tender_code);
    const amt = round2(num(r.tender_amt));
    const bucket = tenderByHour.get(hr) ?? emptyTenderBreakdown();
    bucket[code] = round2((bucket[code] ?? 0) + amt);
    tenderByHour.set(hr, bucket);
    tenderTotals[code] = round2((tenderTotals[code] ?? 0) + amt);
  }

  const rawHours: HourlyReportRow[] = Array.from({ length: 24 }, (_, hourOfDay) => {
    const r = byHour.get(hourOfDay);
    const billCount = num(r?.bill_count);
    const grossSalesHkd = round2(num(r?.gross_sales));
    const discountHkd = round2(num(r?.discounts));
    const returnHkd = round2(num(r?.returns_amt));
    const netSalesHkd = round2(num(r?.net_sales));
    return {
      hourOfDay,
      billCount,
      grossSalesHkd,
      discountHkd,
      returnHkd,
      netSalesHkd,
      averageBillHkd: billCount ? round2(netSalesHkd / billCount) : 0,
      sharePct: 0,
      byTender: tenderByHour.get(hourOfDay) ?? emptyTenderBreakdown(),
    };
  });

  const totalBills = rawHours.reduce((s, r) => s + r.billCount, 0);
  const totalGrossHkd = round2(rawHours.reduce((s, r) => s + r.grossSalesHkd, 0));
  const totalDiscountHkd = round2(rawHours.reduce((s, r) => s + r.discountHkd, 0));
  const totalReturnHkd = round2(rawHours.reduce((s, r) => s + r.returnHkd, 0));
  const totalSalesHkd = round2(rawHours.reduce((s, r) => s + r.netSalesHkd, 0));

  const hours = rawHours.map((h) => ({
    ...h,
    sharePct: totalSalesHkd ? round2((h.netSalesHkd / totalSalesHkd) * 100) : 0,
  }));

  const periodDefs = [
    { key: "P1", label: "分段一 (早市 00:00 - 11:59)", fromHour: 0, toHour: 11 },
    { key: "P2", label: "分段二 (午市 12:00 - 14:59)", fromHour: 12, toHour: 14 },
    { key: "P3", label: "分段三 (下午 15:00 - 17:59)", fromHour: 15, toHour: 17 },
    { key: "P4", label: "分段四 (晚市 18:00 - 23:59)", fromHour: 18, toHour: 23 },
  ];

  const periods = periodDefs.map((p) => {
    const slice = hours.filter((h) => h.hourOfDay >= p.fromHour && h.hourOfDay <= p.toHour);
    const billCount = slice.reduce((s, r) => s + r.billCount, 0);
    const grossSalesHkd = round2(slice.reduce((s, r) => s + r.grossSalesHkd, 0));
    const discountHkd = round2(slice.reduce((s, r) => s + r.discountHkd, 0));
    const returnHkd = round2(slice.reduce((s, r) => s + r.returnHkd, 0));
    const netSalesHkd = round2(slice.reduce((s, r) => s + r.netSalesHkd, 0));
    return {
      key: p.key,
      label: p.label,
      billCount,
      grossSalesHkd,
      discountHkd,
      returnHkd,
      netSalesHkd,
      averageBillHkd: billCount ? round2(netSalesHkd / billCount) : 0,
      sharePct: totalSalesHkd ? round2((netSalesHkd / totalSalesHkd) * 100) : 0,
    };
  });

  return {
    businessDate,
    totalBills,
    totalGrossHkd,
    totalDiscountHkd,
    totalReturnHkd,
    totalSalesHkd,
    averageBillHkd: totalBills ? round2(totalSalesHkd / totalBills) : 0,
    hours,
    periods,
    tenderTotals,
    cancelledBillCount: num(voidRows[0][0]?.cancelled_bills),
    cancelledAmountHkd: round2(num(voidRows[0][0]?.cancelled_amt)),
    cancelledLineCount: num(voidLineRows[0][0]?.cancelled_lines),
  };
}

/** Legacy fmshiftreport / batchheader / batchdetail shift & EOD reconciliation report. */
export async function getShiftDayEndReport(params: {
  fromDate: string;
  toDate: string;
  shopId: number;
  focusDate?: string;
  focusBatchId?: number;
}) {
  const { pool } = requireSharedDb();
  const focusDate = params.focusDate || params.toDate;

  const [batchRows] = await pool.query<SqlRow[]>(
    `SELECT
      deb.id,
      deb.legacy_bk,
      s.code AS shop_code,
      s.legacy_sn,
      t.legacy_mn,
      deb.business_date,
      deb.batch_no,
      deb.status,
      deb.issued_sales_total,
      deb.collected_payments_total,
      deb.closed,
      deb.closed_at
    FROM day_end_batches deb
    INNER JOIN shops s ON s.id = deb.shop_id
    INNER JOIN terminals t ON t.id = deb.terminal_id
    WHERE deb.shop_id = ?
      AND deb.business_date >= ?
      AND deb.business_date <= ?
    ORDER BY deb.business_date DESC, deb.batch_no DESC
    LIMIT 120`,
    [params.shopId, params.fromDate, params.toDate],
  );

  const datesToEnrich = Array.from(
    new Set([focusDate, ...batchRows.map((b) => str(b.business_date))]),
  ).filter(Boolean);

  const salesByDate = new Map<
    string,
    { billCount: number; issuedHkd: number; unpaidHkd: number; payoutHkd: number }
  >();
  const floatByDate = new Map<string, number>();

  if (datesToEnrich.length > 0) {
    const placeholders = datesToEnrich.map(() => "?").join(",");
    const floatKeys = datesToEnrich.map((d) => `opening_float_${d}`);
    const [[billAggRows], [floatRows]] = await Promise.all([
      pool.query<SqlRow[]>(
        `SELECT
          b.business_date,
          SUM(CASE WHEN b.doc_type IN (${SALES_DOC_TYPES_SQL}) THEN 1 ELSE 0 END) AS bill_count,
          COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -b.net_amount WHEN b.doc_type IN ('RETAIL_SALE', 'SALES_INVOICE') THEN b.net_amount ELSE 0 END), 0) AS issued_total,
          COALESCE(SUM(CASE WHEN b.doc_type IN (${SALES_DOC_TYPES_SQL}) THEN b.balance_due ELSE 0 END), 0) AS unpaid_total,
          COALESCE(SUM(CASE WHEN b.doc_type = 'PETTY_PAYOUT' THEN b.net_amount ELSE 0 END), 0) AS payout_total
        FROM bills b
        WHERE b.shop_id = ?
          AND b.business_date IN (${placeholders})
          AND b.status NOT IN ('cancelled', 'held')
        GROUP BY b.business_date`,
        [params.shopId, ...datesToEnrich],
      ),
      pool.query<SqlRow[]>(
        `SELECT setting_key, setting_value
        FROM app_settings
        WHERE shop_id = ?
          AND setting_key IN (${placeholders})`,
        [params.shopId, ...floatKeys],
      ),
    ]);

    for (const r of billAggRows) {
      salesByDate.set(str(r.business_date), {
        billCount: num(r.bill_count),
        issuedHkd: round2(num(r.issued_total)),
        unpaidHkd: round2(num(r.unpaid_total)),
        payoutHkd: round2(num(r.payout_total)),
      });
    }
    for (const r of floatRows) {
      const key = str(r.setting_key).replace("opening_float_", "");
      const rawVal = typeof r.setting_value === "string" ? JSON.parse(r.setting_value) : r.setting_value;
      floatByDate.set(key, round2(num((rawVal as { amountHkd?: number } | null)?.amountHkd)));
    }
  }

  const batchIds = batchRows.map((b) => num(b.id));
  const countsByBatchId = new Map<
    number,
    Array<{ tenderCode: string; expectedHkd: number; countedHkd: number; varianceHkd: number }>
  >();
  if (batchIds.length > 0) {
    const ph = batchIds.map(() => "?").join(",");
    const [tcRows] = await pool.query<SqlRow[]>(
      `SELECT batch_id, tender_code, expected_collected_amount, counted_amount, variance_amount
      FROM day_end_tender_counts
      WHERE batch_id IN (${ph})
      ORDER BY id ASC`,
      batchIds,
    );
    for (const r of tcRows) {
      const bid = num(r.batch_id);
      const arr = countsByBatchId.get(bid) ?? [];
      arr.push({
        tenderCode: str(r.tender_code),
        expectedHkd: round2(num(r.expected_collected_amount)),
        countedHkd: round2(num(r.counted_amount)),
        varianceHkd: round2(num(r.variance_amount)),
      });
      countsByBatchId.set(bid, arr);
    }
  }

  const batches = batchRows.map((b) => {
    const id = num(b.id);
    const bDate = str(b.business_date);
    const stats = salesByDate.get(bDate);
    const tc = countsByBatchId.get(id) ?? [];
    const cashRow = tc.find((x) => x.tenderCode === "CASH");
    const countedTotalHkd =
      tc.length > 0 ? round2(tc.reduce((s, r) => s + r.countedHkd, 0)) : round2(num(b.collected_payments_total));
    const varianceTotalHkd = round2(tc.reduce((s, r) => s + r.varianceHkd, 0));
    const expectedCashHkd = cashRow ? cashRow.expectedHkd : 0;
    const collectedTotalHkd = round2(num(b.collected_payments_total));
    const nonCashExpectedHkd = round2(collectedTotalHkd - expectedCashHkd);
    const openingFloatHkd = floatByDate.get(bDate) ?? 0;

    return {
      id,
      legacyBk: b.legacy_bk ? str(b.legacy_bk) : null,
      shopCode: str(b.shop_code),
      legacySn: num(b.legacy_sn),
      terminalMn: num(b.legacy_mn),
      businessDate: bDate,
      batchNo: num(b.batch_no),
      status: str(b.status),
      closed: Boolean(b.closed),
      closedAtIso: b.closed_at ? new Date(b.closed_at as string | Date).toISOString() : null,
      openingFloatHkd,
      billCount: stats?.billCount ?? 0,
      issuedSalesHkd: round2(num(b.issued_sales_total) || stats?.issuedHkd || 0),
      collectedTotalHkd,
      payoutTotalHkd: stats?.payoutHkd ?? 0,
      unpaidArHkd: stats?.unpaidHkd ?? 0,
      expectedCashHkd,
      nonCashExpectedHkd,
      countedTotalHkd,
      varianceTotalHkd,
      toBankHkd: round2(Math.max(0, (cashRow?.countedHkd ?? expectedCashHkd))),
    };
  });

  // Include live OPEN shift entry for focusDate if no batch row covers focusDate and activity exists.
  const focusHasBatch = batches.some((b) => b.businessDate === focusDate);
  const focusStats = salesByDate.get(focusDate);
  const focusFloat = floatByDate.get(focusDate) ?? 0;
  if (!focusHasBatch && (focusFloat > 0 || (focusStats && (focusStats.billCount > 0 || focusStats.payoutHkd > 0)))) {
    const [openPmts] = await pool.query<SqlRow[]>(
      `SELECT
        bp.tender_code,
        COALESCE(SUM(CASE WHEN b.doc_type IN ('SALES_RETURN', 'PETTY_PAYOUT') THEN -bp.amount ELSE bp.amount END), 0) AS amt
      FROM bill_payments bp
      INNER JOIN bills b ON b.id = bp.bill_id
      WHERE b.shop_id = ?
        AND bp.business_date = ?
        AND bp.voided = 0
        AND b.status NOT IN ('cancelled', 'held')
      GROUP BY bp.tender_code`,
      [params.shopId, focusDate],
    );
    const collectedTotalHkd = round2(openPmts.reduce((s, r) => s + num(r.amt), 0));
    const expectedCashHkd = round2(
      openPmts.filter((r) => str(r.tender_code) === "CASH").reduce((s, r) => s + num(r.amt), 0),
    );
    batches.unshift({
      id: 0,
      legacyBk: null,
      shopCode: "01",
      legacySn: 1,
      terminalMn: 1,
      businessDate: focusDate,
      batchNo: 0,
      status: "open",
      closed: false,
      closedAtIso: null,
      openingFloatHkd: focusFloat,
      billCount: focusStats?.billCount ?? 0,
      issuedSalesHkd: focusStats?.issuedHkd ?? 0,
      collectedTotalHkd,
      payoutTotalHkd: focusStats?.payoutHkd ?? 0,
      unpaidArHkd: focusStats?.unpaidHkd ?? 0,
      expectedCashHkd,
      nonCashExpectedHkd: round2(collectedTotalHkd - expectedCashHkd),
      countedTotalHkd: collectedTotalHkd,
      varianceTotalHkd: 0,
      toBankHkd: round2(Math.max(0, expectedCashHkd)),
    });
  }

  const selectedBatch =
    (params.focusBatchId !== undefined ? batches.find((b) => b.id === params.focusBatchId) : undefined) ??
    batches.find((b) => b.businessDate === focusDate) ??
    batches[0] ??
    null;

  let detailTenders: Array<{
    tenderCode: string;
    tenderNameZh: string;
    legacyPm: number;
    txCount: number;
    expectedAmountHkd: number;
    countedAmountHkd: number;
    varianceAmountHkd: number;
  }> = [];

  if (selectedBatch) {
    const [txRows] = await pool.query<SqlRow[]>(
      `SELECT
        bp.tender_code,
        COUNT(*) AS tx_count,
        COALESCE(SUM(CASE WHEN b.doc_type IN ('SALES_RETURN', 'PETTY_PAYOUT') THEN -bp.amount ELSE bp.amount END), 0) AS amt
      FROM bill_payments bp
      INNER JOIN bills b ON b.id = bp.bill_id
      WHERE b.shop_id = ?
        AND bp.business_date = ?
        AND bp.voided = 0
        AND b.status NOT IN ('cancelled', 'held')
      GROUP BY bp.tender_code`,
      [params.shopId, selectedBatch.businessDate],
    );
    const txByCode = new Map(txRows.map((r) => [str(r.tender_code), r]));
    const storedCounts = selectedBatch.id > 0 ? countsByBatchId.get(selectedBatch.id) ?? [] : [];
    const storedByCode = new Map(storedCounts.map((c) => [c.tenderCode, c]));
    const allCodes = Array.from(new Set([...txByCode.keys(), ...storedByCode.keys()]));

    detailTenders = allCodes
      .map((code) => {
        const tx = txByCode.get(code);
        const st = storedByCode.get(code);
        const meta = TENDER_LABELS[code] ?? { zh: code, pm: 99 };
        const expectedAmountHkd = st ? st.expectedHkd : round2(num(tx?.amt));
        const countedAmountHkd = st ? st.countedHkd : expectedAmountHkd;
        return {
          tenderCode: code,
          tenderNameZh: meta.zh,
          legacyPm: meta.pm,
          txCount: num(tx?.tx_count),
          expectedAmountHkd,
          countedAmountHkd,
          varianceAmountHkd: st ? st.varianceHkd : round2(countedAmountHkd - expectedAmountHkd),
        };
      })
      .sort((a, b) => a.legacyPm - b.legacyPm);
  }

  return {
    range: { fromDate: params.fromDate, toDate: params.toDate },
    batches,
    selectedBatch,
    detailTenders,
  };
}

/** Legacy listXDetail / fmAllStatCHsales item-level sales & moving-avg cost margin report. */
export async function getItemSalesReport(
  businessDate: string,
  shopId: number,
  opts?: { toDate?: string; categoryC1?: number; q?: string },
) {
  const { pool } = requireSharedDb();
  const toDate = opts?.toDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.toDate) ? opts.toDate : businessDate;
  const whereParts = [
    "b.shop_id = ?",
    "b.business_date >= ?",
    "b.business_date <= ?",
    "b.status NOT IN ('cancelled', 'held')",
    `b.doc_type IN (${SALES_DOC_TYPES_SQL})`,
    "bl.cancelled = 0",
    "bl.legacy_dk > 0",
  ];
  const args: Array<string | number> = [shopId, businessDate, toDate];

  if (opts?.categoryC1 !== undefined && Number.isFinite(opts.categoryC1)) {
    whereParts.push("bl.category_c1 = ?");
    args.push(opts.categoryC1);
  }
  const cleanQ = opts?.q?.trim();
  if (cleanQ) {
    const pat = `%${cleanQ}%`;
    whereParts.push("(bl.sku LIKE ? OR bl.name_zh LIKE ? OR bl.name_en LIKE ? OR COALESCE(p.ubc, '') LIKE ?)");
    args.push(pat, pat, pat, pat);
  }

  const [rows] = await pool.query<SqlRow[]>(
    `SELECT
      bl.sku,
      MAX(COALESCE(p.ubc, '')) AS ubc,
      MAX(bl.name_zh) AS name_zh,
      MAX(bl.name_en) AS name_en,
      MAX(bl.category_c1) AS category_c1,
      MAX(COALESCE(c.name_zh, CONCAT('C1=', bl.category_c1))) AS category_name,
      MAX(COALESCE(u.name_zh, '件')) AS unit_name,
      COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -bl.quantity ELSE bl.quantity END), 0) AS qty,
      COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -(bl.quantity * bl.unit_price) ELSE (bl.quantity * bl.unit_price) END), 0) AS gross_sales,
      COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -bl.line_total ELSE bl.line_total END), 0) AS net_sales,
      MAX(COALESCE(sb.moving_avg_cost, p.avg_cost, 0)) AS avg_cost_unit,
      MAX(COALESCE(sb.on_hand_qty, 0)) AS on_hand_qty
    FROM bill_lines bl
    INNER JOIN bills b ON b.id = bl.bill_id
    LEFT JOIN products p ON p.id = bl.product_id
    LEFT JOIN categories c ON c.legacy_c1 = bl.category_c1
    LEFT JOIN units u ON u.id = p.unit_id
    LEFT JOIN stock_balances sb ON sb.product_id = bl.product_id AND sb.shop_id = b.shop_id
    WHERE ${whereParts.join(" AND ")}
    GROUP BY bl.sku
    ORDER BY net_sales DESC, bl.sku ASC`,
    args,
  );

  const totalSalesHkd = round2(rows.reduce((s, r) => s + num(r.net_sales), 0));
  const items = rows.map((r) => {
    const quantity = round4(num(r.qty));
    const grossSalesHkd = round2(num(r.gross_sales));
    const netSalesHkd = round2(num(r.net_sales));
    const discountHkd = round2(grossSalesHkd - netSalesHkd);
    const avgCostUnitHkd = round2(num(r.avg_cost_unit));
    const costAvHkd = round2(quantity * avgCostUnitHkd);
    const marginAvHkd = round2(netSalesHkd - costAvHkd);
    const marginAvPct = netSalesHkd !== 0 ? round2((marginAvHkd / netSalesHkd) * 100) : 0;
    const avgUnitPriceHkd = quantity !== 0 ? round2(netSalesHkd / quantity) : 0;

    return {
      sku: str(r.sku),
      ubc: str(r.ubc),
      nameZh: str(r.name_zh),
      nameEn: str(r.name_en),
      categoryC1: num(r.category_c1),
      categoryName: str(r.category_name),
      unitName: str(r.unit_name),
      quantity,
      avgUnitPriceHkd,
      grossSalesHkd,
      discountHkd,
      netSalesHkd,
      avgCostUnitHkd,
      costAvHkd,
      marginAvHkd,
      marginAvPct,
      onHandQty: round2(num(r.on_hand_qty)),
      salesShare: totalSalesHkd !== 0 ? netSalesHkd / totalSalesHkd : 0,
    };
  });

  const totalQty = round2(items.reduce((s, r) => s + r.quantity, 0));
  const totalGrossHkd = round2(items.reduce((s, r) => s + r.grossSalesHkd, 0));
  const totalDiscountHkd = round2(items.reduce((s, r) => s + r.discountHkd, 0));
  const totalCostAvHkd = round2(items.reduce((s, r) => s + r.costAvHkd, 0));
  const totalMarginAvHkd = round2(totalSalesHkd - totalCostAvHkd);
  const totalMarginAvPct = totalSalesHkd !== 0 ? round2((totalMarginAvHkd / totalSalesHkd) * 100) : 0;

  return {
    businessDate,
    toDate,
    totalQty,
    totalGrossHkd,
    totalDiscountHkd,
    totalSalesHkd,
    totalCostAvHkd,
    totalMarginAvHkd,
    totalMarginAvPct,
    items,
  };
}

export type HistoryGranularity = "day" | "week" | "month" | "quarter" | "year" | "weekday";

function historyBucketExpr(granularity: HistoryGranularity, col: string): { expr: string; orderExpr: string } {
  switch (granularity) {
    case "week":
      return {
        expr: `DATE_FORMAT(STR_TO_DATE(${col}, '%Y-%m-%d'), '%x-W%v')`,
        orderExpr: `MAX(${col})`,
      };
    case "month":
      return { expr: `LEFT(${col}, 7)`, orderExpr: `LEFT(${col}, 7)` };
    case "quarter":
      return {
        expr: `CONCAT(LEFT(${col}, 4), '-Q', QUARTER(STR_TO_DATE(${col}, '%Y-%m-%d')))`,
        orderExpr: `CONCAT(LEFT(${col}, 4), '-Q', QUARTER(STR_TO_DATE(${col}, '%Y-%m-%d')))`,
      };
    case "year":
      return { expr: `LEFT(${col}, 4)`, orderExpr: `LEFT(${col}, 4)` };
    case "weekday":
      return {
        expr: `CAST(WEEKDAY(STR_TO_DATE(${col}, '%Y-%m-%d')) AS CHAR)`,
        orderExpr: `MIN(WEEKDAY(STR_TO_DATE(${col}, '%Y-%m-%d')))`,
      };
    default:
      return { expr: col, orderExpr: col };
  }
}

const WEEKDAY_ZH = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

/** Legacy dhsales / ReportM multi-granularity sales & tender trend report. */
export async function getHistoricalSalesReport(
  fromDate: string,
  toDate: string,
  shopId: number,
  granularity: HistoryGranularity = "day",
) {
  const { pool } = requireSharedDb();
  const bBucket = historyBucketExpr(granularity, "b.business_date");
  const pBucket = historyBucketExpr(granularity, "bp.business_date");

  const [billRows, pmtRows] = await Promise.all([
    pool.query<SqlRow[]>(
      `SELECT
        ${bBucket.expr} AS period_key,
        SUM(CASE WHEN b.status NOT IN ('cancelled', 'held') AND b.doc_type IN (${SALES_DOC_TYPES_SQL}) THEN 1 ELSE 0 END) AS bill_count,
        SUM(CASE WHEN b.status = 'cancelled' AND b.doc_type IN (${SALES_DOC_TYPES_SQL}) THEN 1 ELSE 0 END) AS cancelled_count,
        COALESCE(SUM(CASE WHEN b.status NOT IN ('cancelled', 'held') AND b.doc_type IN (${SALES_DOC_TYPES_SQL}) THEN (CASE WHEN b.doc_type = 'SALES_RETURN' THEN -b.gross_amount ELSE b.gross_amount END) ELSE 0 END), 0) AS gross_sales,
        COALESCE(SUM(CASE WHEN b.status NOT IN ('cancelled', 'held') AND b.doc_type IN (${SALES_DOC_TYPES_SQL}) THEN (CASE WHEN b.doc_type = 'SALES_RETURN' THEN -b.discount_amount ELSE b.discount_amount END) ELSE 0 END), 0) AS discounts,
        COALESCE(SUM(CASE WHEN b.status NOT IN ('cancelled', 'held') AND b.doc_type = 'SALES_RETURN' THEN b.net_amount ELSE 0 END), 0) AS return_amt,
        COALESCE(SUM(CASE WHEN b.status NOT IN ('cancelled', 'held') AND b.doc_type IN (${SALES_DOC_TYPES_SQL}) THEN (CASE WHEN b.doc_type = 'SALES_RETURN' THEN -b.net_amount ELSE b.net_amount END) ELSE 0 END), 0) AS net_sales,
        COALESCE(SUM(CASE WHEN b.status NOT IN ('cancelled', 'held') AND b.doc_type IN (${SALES_DOC_TYPES_SQL}) THEN (CASE WHEN b.doc_type = 'SALES_RETURN' THEN -b.paid_amount ELSE b.paid_amount END) ELSE 0 END), 0) AS collected,
        COALESCE(SUM(CASE WHEN b.status NOT IN ('cancelled', 'held') AND b.doc_type IN (${SALES_DOC_TYPES_SQL}) THEN b.balance_due ELSE 0 END), 0) AS balance_due,
        COALESCE(SUM(CASE WHEN b.status NOT IN ('cancelled', 'held') AND b.doc_type = 'PETTY_PAYOUT' THEN b.net_amount ELSE 0 END), 0) AS payout_amt
      FROM bills b
      WHERE b.shop_id = ?
        AND b.business_date >= ?
        AND b.business_date <= ?
      GROUP BY period_key
      ORDER BY ${granularity === "weekday" ? `${bBucket.orderExpr} ASC` : `${bBucket.orderExpr} DESC`}`,
      [shopId, fromDate, toDate],
    ),
    pool.query<SqlRow[]>(
      `SELECT
        ${pBucket.expr} AS period_key,
        COALESCE(SUM(CASE WHEN bp.tender_code = 'CASH' THEN (CASE WHEN b.doc_type IN ('SALES_RETURN', 'PETTY_PAYOUT') THEN -bp.amount ELSE bp.amount END) ELSE 0 END), 0) AS cash_amt,
        COALESCE(SUM(CASE WHEN bp.tender_code = 'OCTOPUS' THEN (CASE WHEN b.doc_type IN ('SALES_RETURN', 'PETTY_PAYOUT') THEN -bp.amount ELSE bp.amount END) ELSE 0 END), 0) AS octopus_amt,
        COALESCE(SUM(CASE WHEN bp.tender_code IN ('VISA', 'MASTERCARD', 'UNIONPAY', 'AMEX') THEN (CASE WHEN b.doc_type IN ('SALES_RETURN', 'PETTY_PAYOUT') THEN -bp.amount ELSE bp.amount END) ELSE 0 END), 0) AS card_amt,
        COALESCE(SUM(CASE WHEN bp.tender_code IN ('BANK_XFER', 'CHEQUE') THEN (CASE WHEN b.doc_type IN ('SALES_RETURN', 'PETTY_PAYOUT') THEN -bp.amount ELSE bp.amount END) ELSE 0 END), 0) AS bank_cheque_amt
      FROM bill_payments bp
      INNER JOIN bills b ON b.id = bp.bill_id
      WHERE b.shop_id = ?
        AND bp.business_date >= ?
        AND bp.business_date <= ?
        AND bp.voided = 0
        AND b.status NOT IN ('cancelled', 'held')
      GROUP BY period_key`,
      [shopId, fromDate, toDate],
    ),
  ]);

  const pmtByKey = new Map(pmtRows[0].map((r) => [str(r.period_key), r]));

  const days = billRows[0]
    .filter((r) => num(r.bill_count) > 0 || num(r.cancelled_count) > 0 || num(r.payout_amt) > 0)
    .map((r) => {
      const key = str(r.period_key);
      const pmt = pmtByKey.get(key);
      const billCount = num(r.bill_count);
      const netSalesHkd = round2(num(r.net_sales));
      const periodLabel = granularity === "weekday" ? WEEKDAY_ZH[Number(key)] ?? key : key;
      return {
        businessDate: key,
        periodKey: key,
        periodLabel,
        billCount,
        cancelledCount: num(r.cancelled_count),
        grossSalesHkd: round2(num(r.gross_sales)),
        discountsHkd: round2(num(r.discounts)),
        returnHkd: round2(num(r.return_amt)),
        netSalesHkd,
        avgBillHkd: billCount ? round2(netSalesHkd / billCount) : 0,
        collectedHkd: round2(num(r.collected)),
        balanceDueHkd: round2(num(r.balance_due)),
        payoutHkd: round2(num(r.payout_amt)),
        cashHkd: round2(num(pmt?.cash_amt)),
        octopusHkd: round2(num(pmt?.octopus_amt)),
        cardHkd: round2(num(pmt?.card_amt)),
        bankChequeHkd: round2(num(pmt?.bank_cheque_amt)),
      };
    });

  const totals = days.reduce(
    (acc, d) => ({
      billCount: acc.billCount + d.billCount,
      cancelledCount: acc.cancelledCount + d.cancelledCount,
      grossSalesHkd: round2(acc.grossSalesHkd + d.grossSalesHkd),
      discountsHkd: round2(acc.discountsHkd + d.discountsHkd),
      returnHkd: round2(acc.returnHkd + d.returnHkd),
      netSalesHkd: round2(acc.netSalesHkd + d.netSalesHkd),
      collectedHkd: round2(acc.collectedHkd + d.collectedHkd),
      balanceDueHkd: round2(acc.balanceDueHkd + d.balanceDueHkd),
      payoutHkd: round2(acc.payoutHkd + d.payoutHkd),
      cashHkd: round2(acc.cashHkd + d.cashHkd),
      octopusHkd: round2(acc.octopusHkd + d.octopusHkd),
      cardHkd: round2(acc.cardHkd + d.cardHkd),
      bankChequeHkd: round2(acc.bankChequeHkd + d.bankChequeHkd),
    }),
    {
      billCount: 0,
      cancelledCount: 0,
      grossSalesHkd: 0,
      discountsHkd: 0,
      returnHkd: 0,
      netSalesHkd: 0,
      collectedHkd: 0,
      balanceDueHkd: 0,
      payoutHkd: 0,
      cashHkd: 0,
      octopusHkd: 0,
      cardHkd: 0,
      bankChequeHkd: 0,
    },
  );

  return {
    fromDate,
    toDate,
    granularity,
    days,
    totals: {
      ...totals,
      avgBillHkd: totals.billCount ? round2(totals.netSalesHkd / totals.billCount) : 0,
    },
  };
}

export type AllStatGroupBy = "category" | "product" | "customer" | "staff" | "supplier" | "tender" | "doctype";
export type AllStatDateBucket = "none" | "day" | "month" | "year";
export type AllStatScope = "all" | "retail" | "invoice";

function dateBucketExpr(bucket: AllStatDateBucket, col: string): string {
  switch (bucket) {
    case "day":
      return col;
    case "month":
      return `LEFT(${col}, 7)`;
    case "year":
      return `LEFT(${col}, 4)`;
    default:
      return "'ALL'";
  }
}

export interface AllStatRow {
  groupCode: string;
  groupName: string;
  periodLabel: string;
  billCount: number;
  quantity: number;
  grossHkd: number;
  discountHkd: number;
  netSalesHkd: number;
  costAvHkd: number;
  marginAvHkd: number;
  marginAvPct: number;
  sharePct: number;
}

/** Legacy fmAllStat / BOS 10406 multi-dimensional sales analysis with Sub-Total & Total. */
export async function getAllPurposeStatReport(params: {
  fromDate: string;
  toDate: string;
  shopId: number;
  groupBy: AllStatGroupBy;
  dateBucket: AllStatDateBucket;
  scope: AllStatScope;
}) {
  const { pool } = requireSharedDb();
  const docFilterSql =
    params.scope === "retail"
      ? "'RETAIL_SALE', 'SALES_RETURN'"
      : params.scope === "invoice"
        ? "'SALES_INVOICE'"
        : SALES_DOC_TYPES_SQL;
  const pExpr = dateBucketExpr(params.dateBucket, "b.business_date");

  interface RawStatRow {
    groupCode: string;
    groupName: string;
    periodLabel: string;
    billCount: number;
    quantity: number;
    grossHkd: number;
    netSalesHkd: number;
    costAvHkd: number;
  }

  let rawRows: RawStatRow[] = [];

  if (params.groupBy === "tender") {
    const pmtPeriod = dateBucketExpr(params.dateBucket, "bp.business_date");
    const [rows] = await pool.query<SqlRow[]>(
      `SELECT
        bp.tender_code AS grp_code,
        MAX(COALESCE(pm.name_zh, bp.tender_code)) AS grp_name,
        ${pmtPeriod} AS period_label,
        COUNT(DISTINCT b.id) AS bill_count,
        COUNT(*) AS qty,
        COALESCE(SUM(CASE WHEN b.doc_type IN ('SALES_RETURN', 'PETTY_PAYOUT') THEN -bp.amount ELSE bp.amount END), 0) AS net_sales
      FROM bill_payments bp
      INNER JOIN bills b ON b.id = bp.bill_id
      LEFT JOIN pay_methods pm ON pm.code = bp.tender_code
      WHERE b.shop_id = ?
        AND bp.business_date >= ?
        AND bp.business_date <= ?
        AND bp.voided = 0
        AND b.status NOT IN ('cancelled', 'held')
        ${params.scope === "all" ? "" : `AND b.doc_type IN (${docFilterSql})`}
      GROUP BY bp.tender_code, ${pmtPeriod}
      ORDER BY net_sales DESC, grp_code ASC`,
      [params.shopId, params.fromDate, params.toDate],
    );
    rawRows = rows.map((r) => ({
      groupCode: str(r.grp_code),
      groupName: str(r.grp_name),
      periodLabel: params.dateBucket === "none" ? "合計期間" : str(r.period_label),
      billCount: num(r.bill_count),
      quantity: num(r.qty),
      grossHkd: round2(num(r.net_sales)),
      netSalesHkd: round2(num(r.net_sales)),
      costAvHkd: 0,
    }));
  } else if (params.groupBy === "doctype") {
    const [rows] = await pool.query<SqlRow[]>(
      `SELECT
        b.doc_type AS grp_code,
        ${pExpr} AS period_label,
        COUNT(*) AS bill_count,
        COALESCE(SUM(CASE WHEN b.doc_type IN ('SALES_RETURN', 'PURCHASE_RETURN', 'WRITE_OFF', 'PETTY_PAYOUT') THEN -b.gross_amount ELSE b.gross_amount END), 0) AS gross_sales,
        COALESCE(SUM(CASE WHEN b.doc_type IN ('SALES_RETURN', 'PURCHASE_RETURN', 'WRITE_OFF', 'PETTY_PAYOUT') THEN -b.net_amount ELSE b.net_amount END), 0) AS net_sales
      FROM bills b
      WHERE b.shop_id = ?
        AND b.business_date >= ?
        AND b.business_date <= ?
        AND b.status NOT IN ('cancelled', 'held')
      GROUP BY b.doc_type, ${pExpr}
      ORDER BY bill_count DESC`,
      [params.shopId, params.fromDate, params.toDate],
    );
    rawRows = rows.map((r) => {
      const code = str(r.grp_code);
      const meta = DOC_TYPE_META[code];
      return {
        groupCode: meta ? `${code} (XC=${meta.xc})` : code,
        groupName: meta ? meta.zh : code,
        periodLabel: params.dateBucket === "none" ? "合計期間" : str(r.period_label),
        billCount: num(r.bill_count),
        quantity: num(r.bill_count),
        grossHkd: round2(num(r.gross_sales)),
        netSalesHkd: round2(num(r.net_sales)),
        costAvHkd: 0,
      };
    });
  } else if (params.groupBy === "supplier") {
    const [hdrRows, lineRows] = await Promise.all([
      pool.query<SqlRow[]>(
        `SELECT
          COALESCE(NULLIF(b.legacy_sc, ''), 'UNSPECIFIED') AS grp_code,
          MAX(COALESCE(sup.name_zh, NULLIF(b.legacy_sc, ''), '未指定供應商')) AS grp_name,
          ${pExpr} AS period_label,
          COUNT(*) AS bill_count,
          COALESCE(SUM(CASE WHEN b.doc_type = 'PURCHASE_RETURN' THEN -b.gross_amount ELSE b.gross_amount END), 0) AS gross_sales,
          COALESCE(SUM(CASE WHEN b.doc_type = 'PURCHASE_RETURN' THEN -b.net_amount ELSE b.net_amount END), 0) AS net_sales
        FROM bills b
        LEFT JOIN suppliers sup ON sup.legacy_id = b.legacy_sc
        WHERE b.shop_id = ?
          AND b.business_date >= ?
          AND b.business_date <= ?
          AND b.status NOT IN ('cancelled', 'held')
          AND b.doc_type IN ('GOODS_RECEIPT', 'PURCHASE_RETURN')
        GROUP BY COALESCE(NULLIF(b.legacy_sc, ''), 'UNSPECIFIED'), ${pExpr}
        ORDER BY net_sales DESC`,
        [params.shopId, params.fromDate, params.toDate],
      ),
      pool.query<SqlRow[]>(
        `SELECT
          COALESCE(NULLIF(b.legacy_sc, ''), 'UNSPECIFIED') AS grp_code,
          ${pExpr} AS period_label,
          COALESCE(SUM(CASE WHEN b.doc_type = 'PURCHASE_RETURN' THEN -bl.quantity ELSE bl.quantity END), 0) AS qty
        FROM bill_lines bl
        INNER JOIN bills b ON b.id = bl.bill_id
        WHERE b.shop_id = ?
          AND b.business_date >= ?
          AND b.business_date <= ?
          AND b.status NOT IN ('cancelled', 'held')
          AND b.doc_type IN ('GOODS_RECEIPT', 'PURCHASE_RETURN')
          AND bl.cancelled = 0
        GROUP BY COALESCE(NULLIF(b.legacy_sc, ''), 'UNSPECIFIED'), ${pExpr}`,
        [params.shopId, params.fromDate, params.toDate],
      ),
    ]);
    const qtyMap = new Map(lineRows[0].map((r) => [`${str(r.grp_code)}|${str(r.period_label)}`, num(r.qty)]));
    rawRows = hdrRows[0].map((r) => {
      const code = str(r.grp_code);
      const pKey = str(r.period_label);
      return {
        groupCode: code,
        groupName: str(r.grp_name),
        periodLabel: params.dateBucket === "none" ? "合計期間" : pKey,
        billCount: num(r.bill_count),
        quantity: round2(qtyMap.get(`${code}|${pKey}`) ?? 0),
        grossHkd: round2(num(r.gross_sales)),
        netSalesHkd: round2(num(r.net_sales)),
        costAvHkd: round2(num(r.net_sales)),
      };
    });
  } else if (params.groupBy === "customer" || params.groupBy === "staff") {
    const isCust = params.groupBy === "customer";
    const keyCol = isCust ? "COALESCE(c.legacy_id, 'WALKIN')" : "COALESCE(st.legacy_id, 'UNASSIGNED')";
    const nameCol = isCust
      ? "COALESCE(NULLIF(c.name_zh, ''), NULLIF(c.name_en, ''), '非會員 / 散客')"
      : "COALESCE(st.display_name, '未指定職員')";
    const joinSql = isCust
      ? "LEFT JOIN customers c ON c.id = b.customer_id"
      : "LEFT JOIN staff st ON st.id = b.staff_id";

    const [hdrRows, lineRows] = await Promise.all([
      pool.query<SqlRow[]>(
        `SELECT
          ${keyCol} AS grp_code,
          MAX(${nameCol}) AS grp_name,
          ${pExpr} AS period_label,
          COUNT(*) AS bill_count,
          COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -b.gross_amount ELSE b.gross_amount END), 0) AS gross_sales,
          COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -b.net_amount ELSE b.net_amount END), 0) AS net_sales
        FROM bills b
        ${joinSql}
        WHERE b.shop_id = ?
          AND b.business_date >= ?
          AND b.business_date <= ?
          AND b.status NOT IN ('cancelled', 'held')
          AND b.doc_type IN (${docFilterSql})
        GROUP BY ${keyCol}, ${pExpr}
        ORDER BY net_sales DESC, grp_code ASC`,
        [params.shopId, params.fromDate, params.toDate],
      ),
      pool.query<SqlRow[]>(
        `SELECT
          ${keyCol} AS grp_code,
          ${pExpr} AS period_label,
          COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -bl.quantity ELSE bl.quantity END), 0) AS qty,
          COALESCE(SUM((CASE WHEN b.doc_type = 'SALES_RETURN' THEN -bl.quantity ELSE bl.quantity END) * COALESCE(sb.moving_avg_cost, p.avg_cost, 0)), 0) AS cost_av
        FROM bill_lines bl
        INNER JOIN bills b ON b.id = bl.bill_id
        ${joinSql}
        LEFT JOIN products p ON p.id = bl.product_id
        LEFT JOIN stock_balances sb ON sb.product_id = bl.product_id AND sb.shop_id = b.shop_id
        WHERE b.shop_id = ?
          AND b.business_date >= ?
          AND b.business_date <= ?
          AND b.status NOT IN ('cancelled', 'held')
          AND b.doc_type IN (${docFilterSql})
          AND bl.cancelled = 0
          AND bl.legacy_dk > 0
        GROUP BY ${keyCol}, ${pExpr}`,
        [params.shopId, params.fromDate, params.toDate],
      ),
    ]);

    const lineMap = new Map(
      lineRows[0].map((r) => [`${str(r.grp_code)}|${str(r.period_label)}`, r]),
    );
    rawRows = hdrRows[0].map((r) => {
      const code = str(r.grp_code);
      const pKey = str(r.period_label);
      const l = lineMap.get(`${code}|${pKey}`);
      return {
        groupCode: code,
        groupName: str(r.grp_name),
        periodLabel: params.dateBucket === "none" ? "合計期間" : pKey,
        billCount: num(r.bill_count),
        quantity: round2(num(l?.qty)),
        grossHkd: round2(num(r.gross_sales)),
        netSalesHkd: round2(num(r.net_sales)),
        costAvHkd: round2(num(l?.cost_av)),
      };
    });
  } else {
    // category | product
    const isCat = params.groupBy === "category";
    const grpKey = isCat ? "CAST(bl.category_c1 AS CHAR)" : "bl.sku";
    const grpName = isCat
      ? "COALESCE(c.name_zh, CONCAT('分類 ', bl.category_c1))"
      : "COALESCE(NULLIF(bl.name_zh, ''), bl.name_en, bl.sku)";

    const [rows] = await pool.query<SqlRow[]>(
      `SELECT
        ${grpKey} AS grp_code,
        MAX(${grpName}) AS grp_name,
        ${pExpr} AS period_label,
        COUNT(DISTINCT b.id) AS bill_count,
        COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -bl.quantity ELSE bl.quantity END), 0) AS qty,
        COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -(bl.quantity * bl.unit_price) ELSE (bl.quantity * bl.unit_price) END), 0) AS gross_sales,
        COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -bl.line_total ELSE bl.line_total END), 0) AS net_sales,
        COALESCE(SUM((CASE WHEN b.doc_type = 'SALES_RETURN' THEN -bl.quantity ELSE bl.quantity END) * COALESCE(sb.moving_avg_cost, p.avg_cost, 0)), 0) AS cost_av
      FROM bill_lines bl
      INNER JOIN bills b ON b.id = bl.bill_id
      LEFT JOIN categories c ON c.legacy_c1 = bl.category_c1
      LEFT JOIN products p ON p.id = bl.product_id
      LEFT JOIN stock_balances sb ON sb.product_id = bl.product_id AND sb.shop_id = b.shop_id
      WHERE b.shop_id = ?
        AND b.business_date >= ?
        AND b.business_date <= ?
        AND b.status NOT IN ('cancelled', 'held')
        AND b.doc_type IN (${docFilterSql})
        AND bl.cancelled = 0
        AND bl.legacy_dk > 0
      GROUP BY ${grpKey}, ${pExpr}
      ORDER BY grp_code ASC, period_label ASC`,
      [params.shopId, params.fromDate, params.toDate],
    );
    rawRows = rows.map((r) => ({
      groupCode: str(r.grp_code),
      groupName: str(r.grp_name),
      periodLabel: params.dateBucket === "none" ? "合計期間" : str(r.period_label),
      billCount: num(r.bill_count),
      quantity: round2(num(r.qty)),
      grossHkd: round2(num(r.gross_sales)),
      netSalesHkd: round2(num(r.net_sales)),
      costAvHkd: round2(num(r.cost_av)),
    }));
  }

  const grandNet = round2(rawRows.reduce((s, r) => s + r.netSalesHkd, 0));
  const rows: AllStatRow[] = rawRows.map((r) => {
    const discountHkd = round2(r.grossHkd - r.netSalesHkd);
    const marginAvHkd = round2(r.netSalesHkd - r.costAvHkd);
    const marginAvPct = r.netSalesHkd !== 0 ? round2((marginAvHkd / r.netSalesHkd) * 100) : 0;
    const sharePct = grandNet !== 0 ? round2((r.netSalesHkd / grandNet) * 100) : 0;
    return {
      groupCode: r.groupCode,
      groupName: r.groupName,
      periodLabel: r.periodLabel,
      billCount: r.billCount,
      quantity: r.quantity,
      grossHkd: r.grossHkd,
      discountHkd,
      netSalesHkd: r.netSalesHkd,
      costAvHkd: r.costAvHkd,
      marginAvHkd,
      marginAvPct,
      sharePct,
    };
  });

  // Sort high-to-low on netSalesHkd when no date bucket; keep groupCode -> period ordering when date-bucketed for clear 小計
  if (params.dateBucket === "none") {
    rows.sort((a, b) => b.netSalesHkd - a.netSalesHkd || a.groupCode.localeCompare(b.groupCode));
  }

  const subTotalsMap = new Map<string, AllStatRow>();
  if (params.dateBucket !== "none") {
    for (const r of rows) {
      const cur = subTotalsMap.get(r.groupCode) ?? {
        groupCode: r.groupCode,
        groupName: r.groupName,
        periodLabel: "小計",
        billCount: 0,
        quantity: 0,
        grossHkd: 0,
        discountHkd: 0,
        netSalesHkd: 0,
        costAvHkd: 0,
        marginAvHkd: 0,
        marginAvPct: 0,
        sharePct: 0,
      };
      cur.billCount += r.billCount;
      cur.quantity = round2(cur.quantity + r.quantity);
      cur.grossHkd = round2(cur.grossHkd + r.grossHkd);
      cur.discountHkd = round2(cur.discountHkd + r.discountHkd);
      cur.netSalesHkd = round2(cur.netSalesHkd + r.netSalesHkd);
      cur.costAvHkd = round2(cur.costAvHkd + r.costAvHkd);
      cur.marginAvHkd = round2(cur.netSalesHkd - cur.costAvHkd);
      cur.marginAvPct = cur.netSalesHkd !== 0 ? round2((cur.marginAvHkd / cur.netSalesHkd) * 100) : 0;
      cur.sharePct = grandNet !== 0 ? round2((cur.netSalesHkd / grandNet) * 100) : 0;
      subTotalsMap.set(r.groupCode, cur);
    }
  }

  const totalGrossHkd = round2(rows.reduce((s, r) => s + r.grossHkd, 0));
  const totalCostAvHkd = round2(rows.reduce((s, r) => s + r.costAvHkd, 0));
  const totalMarginAvHkd = round2(grandNet - totalCostAvHkd);

  return {
    range: { fromDate: params.fromDate, toDate: params.toDate },
    groupBy: params.groupBy,
    dateBucket: params.dateBucket,
    scope: params.scope,
    rows,
    subTotals: Array.from(subTotalsMap.values()),
    totals: {
      billCount: rows.reduce((s, r) => s + r.billCount, 0),
      quantity: round2(rows.reduce((s, r) => s + r.quantity, 0)),
      grossHkd: totalGrossHkd,
      discountHkd: round2(totalGrossHkd - grandNet),
      netSalesHkd: grandNet,
      costAvHkd: totalCostAvHkd,
      marginAvHkd: totalMarginAvHkd,
      marginAvPct: grandNet !== 0 ? round2((totalMarginAvHkd / grandNet) * 100) : 0,
      sharePct: rows.length > 0 ? 100 : 0,
    },
  };
}

/** Legacy BOS 10403 clsCostSumRpt / uctCostReportList cost & RSP/Net profit report. */
export async function getBosCostReport(params: {
  fromDate: string;
  toDate: string;
  shopId: number;
  dmy: "day" | "month" | "year";
  showShop: boolean;
  showCategory: boolean;
  showUbc: boolean;
}) {
  const { pool } = requireSharedDb();
  const pExpr = dateBucketExpr(params.dmy, "b.business_date");

  const groupCols = [pExpr];
  const shopSelect = params.showShop
    ? "CONCAT(s.name_en, '(', s.legacy_sn, ')') AS shop_label"
    : "MAX(CONCAT(s.name_en, '(', s.legacy_sn, ')')) AS shop_label";
  const catSelect = params.showCategory
    ? "bl.category_c1 AS cat_c1, MAX(COALESCE(c.name_zh, CONCAT('C1=', bl.category_c1))) AS cat_name"
    : "NULL AS cat_c1, '' AS cat_name";
  const prodSelect = params.showUbc
    ? "bl.sku AS sku, MAX(COALESCE(p.ubc, '')) AS ubc, MAX(COALESCE(NULLIF(bl.name_zh, ''), bl.name_en)) AS prod_name"
    : "'' AS sku, '' AS ubc, '' AS prod_name";

  if (params.showShop) groupCols.push("CONCAT(s.name_en, '(', s.legacy_sn, ')')");
  if (params.showCategory) groupCols.push("bl.category_c1");
  if (params.showUbc) groupCols.push("bl.sku");

  const [rows] = await pool.query<SqlRow[]>(
    `SELECT
      ${pExpr} AS period_label,
      ${shopSelect},
      ${catSelect},
      ${prodSelect},
      COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -bl.quantity ELSE bl.quantity END), 0) AS sales_qty,
      COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -(bl.quantity * bl.unit_price) ELSE (bl.quantity * bl.unit_price) END), 0) AS sales_rsp,
      COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -bl.line_total ELSE bl.line_total END), 0) AS sales_net,
      COALESCE(SUM((CASE WHEN b.doc_type = 'SALES_RETURN' THEN -bl.quantity ELSE bl.quantity END) * COALESCE(sb.moving_avg_cost, p.avg_cost, 0)), 0) AS cost_av
    FROM bill_lines bl
    INNER JOIN bills b ON b.id = bl.bill_id
    INNER JOIN shops s ON s.id = b.shop_id
    LEFT JOIN products p ON p.id = bl.product_id
    LEFT JOIN categories c ON c.legacy_c1 = bl.category_c1
    LEFT JOIN stock_balances sb ON sb.product_id = bl.product_id AND sb.shop_id = b.shop_id
    WHERE b.shop_id = ?
      AND b.business_date >= ?
      AND b.business_date <= ?
      AND b.status NOT IN ('cancelled', 'held')
      AND b.doc_type IN (${SALES_DOC_TYPES_SQL})
      AND bl.cancelled = 0
      AND bl.legacy_dk > 0
    GROUP BY ${groupCols.join(", ")}
    ORDER BY period_label DESC, cat_c1 ASC, sku ASC
    LIMIT 1000`,
    [params.shopId, params.fromDate, params.toDate],
  );

  const items = rows.map((r) => {
    const salesQty = round2(num(r.sales_qty));
    const salesRspHkd = round2(num(r.sales_rsp));
    const salesNetHkd = round2(num(r.sales_net));
    const discountHkd = round2(salesRspHkd - salesNetHkd);
    const costAvHkd = round2(num(r.cost_av));
    const profitAvNetHkd = round2(salesNetHkd - costAvHkd);
    return {
      periodLabel: str(r.period_label),
      shopLabel: params.showShop ? str(r.shop_label) : "全店",
      categoryC1: params.showCategory ? num(r.cat_c1) : null,
      categoryName: params.showCategory ? str(r.cat_name) : "",
      sku: params.showUbc ? str(r.sku) : "",
      ubc: params.showUbc ? str(r.ubc) : "",
      productName: params.showUbc ? str(r.prod_name) : "",
      salesQty,
      salesRspHkd,
      discountHkd,
      salesNetHkd,
      costAvHkd,
      costAvRspPct: salesRspHkd !== 0 ? round2((costAvHkd / salesRspHkd) * 100) : 0,
      profitAvNetHkd,
      profitAvNetPct: salesNetHkd !== 0 ? round2((profitAvNetHkd / salesNetHkd) * 100) : 0,
      profitAvRspPct: salesRspHkd !== 0 ? round2(((salesRspHkd - costAvHkd) / salesRspHkd) * 100) : 0,
    };
  });

  const totalsRsp = round2(items.reduce((s, r) => s + r.salesRspHkd, 0));
  const totalsNet = round2(items.reduce((s, r) => s + r.salesNetHkd, 0));
  const totalsCost = round2(items.reduce((s, r) => s + r.costAvHkd, 0));
  const totalsProfit = round2(totalsNet - totalsCost);

  return {
    range: { fromDate: params.fromDate, toDate: params.toDate },
    dmy: params.dmy,
    options: { showShop: params.showShop, showCategory: params.showCategory, showUbc: params.showUbc },
    rows: items,
    totals: {
      salesQty: round2(items.reduce((s, r) => s + r.salesQty, 0)),
      salesRspHkd: totalsRsp,
      discountHkd: round2(totalsRsp - totalsNet),
      salesNetHkd: totalsNet,
      costAvHkd: totalsCost,
      costAvRspPct: totalsRsp !== 0 ? round2((totalsCost / totalsRsp) * 100) : 0,
      profitAvNetHkd: totalsProfit,
      profitAvNetPct: totalsNet !== 0 ? round2((totalsProfit / totalsNet) * 100) : 0,
      profitAvRspPct: totalsRsp !== 0 ? round2(((totalsRsp - totalsCost) / totalsRsp) * 100) : 0,
    },
  };
}

/** Legacy BOS 10405 Stock Value, productlastsale (Slow-Moving), & productqty (Reorder) reports. */
export async function getStockInventoryReport(params: {
  shopId: number;
  subView: "valuation" | "last_sale" | "reorder";
  categoryC1?: number;
  q?: string;
  positiveOnly?: boolean;
  minDaysNotSold?: number;
  reorderThreshold?: number;
  limit?: number;
}) {
  const { pool } = requireSharedDb();
  const todayHkt = formatHktBusinessDate();
  const date90d = shiftDateDays(todayHkt, -90);
  const reorderMin = Math.max(0, params.reorderThreshold ?? 2);
  const maxRows = Math.min(5000, Math.max(10, params.limit ?? 2500));

  const whereParts = ["p.active = 1"];
  const args: Array<string | number> = [todayHkt, date90d, params.shopId, params.shopId];

  if (params.categoryC1 !== undefined && Number.isFinite(params.categoryC1)) {
    whereParts.push("p.legacy_c1 = ?");
    args.push(params.categoryC1);
  }
  const cleanQ = params.q?.trim();
  if (cleanQ) {
    const pat = `%${cleanQ}%`;
    whereParts.push("(p.barcode LIKE ? OR p.ubc LIKE ? OR p.name_zh LIKE ? OR p.name_en LIKE ?)");
    args.push(pat, pat, pat, pat);
  }
  if (params.positiveOnly) {
    whereParts.push("COALESCE(sb.on_hand_qty, 0) > 0");
  }
  if (params.subView === "last_sale" && params.minDaysNotSold && params.minDaysNotSold > 0) {
    whereParts.push(
      "(ss.last_sale_date IS NULL OR DATEDIFF(STR_TO_DATE(?, '%Y-%m-%d'), STR_TO_DATE(ss.last_sale_date, '%Y-%m-%d')) >= ?)",
    );
    args.push(todayHkt, params.minDaysNotSold);
  }
  if (params.subView === "reorder") {
    whereParts.push("COALESCE(sb.on_hand_qty, 0) <= GREATEST(?, COALESCE(ss.sold_90d_qty, 0))");
    args.push(reorderMin);
  }

  args.push(maxRows);

  const orderBy =
    params.subView === "last_sale"
      ? "COALESCE(sb.on_hand_qty, 0) DESC, COALESCE(days_not_sold, 99999) DESC, p.barcode ASC"
      : params.subView === "reorder"
        ? "GREATEST(0, CEIL(GREATEST(" + reorderMin + ", COALESCE(ss.sold_90d_qty, 0)) - COALESCE(sb.on_hand_qty, 0))) DESC, p.barcode ASC"
        : "p.legacy_c1 ASC, p.barcode ASC";

  const [rows] = await pool.query<SqlRow[]>(
    `SELECT
      p.id AS product_id,
      p.barcode,
      p.ubc,
      p.name_zh,
      p.name_en,
      p.legacy_c1,
      COALESCE(c.name_zh, CONCAT('C1=', p.legacy_c1)) AS category_name,
      COALESCE(u.name_zh, '件') AS unit_name,
      COALESCE(sb.on_hand_qty, 0) AS on_hand_qty,
      COALESCE(sb.moving_avg_cost, p.avg_cost, 0) AS avg_cost,
      COALESCE(p.last_purchase_cost, 0) AS last_cost,
      p.sell_price,
      ss.last_sale_date,
      CASE WHEN ss.last_sale_date IS NULL THEN NULL ELSE DATEDIFF(STR_TO_DATE(?, '%Y-%m-%d'), STR_TO_DATE(ss.last_sale_date, '%Y-%m-%d')) END AS days_not_sold,
      COALESCE(ss.total_sold_qty, 0) AS total_sold_qty,
      COALESCE(ss.sold_90d_qty, 0) AS sold_90d_qty,
      COALESCE(sb.updated_at, p.updated_at) AS updated_at
    FROM products p
    LEFT JOIN categories c ON c.legacy_c1 = p.legacy_c1
    LEFT JOIN units u ON u.id = p.unit_id
    LEFT JOIN (
      SELECT
        bl.product_id,
        MAX(b.business_date) AS last_sale_date,
        COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -bl.quantity ELSE bl.quantity END), 0) AS total_sold_qty,
        COALESCE(SUM(CASE WHEN b.business_date >= ? THEN (CASE WHEN b.doc_type = 'SALES_RETURN' THEN -bl.quantity ELSE bl.quantity END) ELSE 0 END), 0) AS sold_90d_qty
      FROM bill_lines bl
      INNER JOIN bills b ON b.id = bl.bill_id
      WHERE b.shop_id = ?
        AND b.status NOT IN ('cancelled', 'held')
        AND b.doc_type IN (${SALES_DOC_TYPES_SQL})
        AND bl.cancelled = 0
        AND bl.legacy_dk > 0
        AND bl.product_id IS NOT NULL
      GROUP BY bl.product_id
    ) ss ON ss.product_id = p.id
    LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.shop_id = ?
    WHERE ${whereParts.join(" AND ")}
    ORDER BY ${orderBy}
    LIMIT ?`,
    args,
  );

  const items = rows.map((r) => {
    const onHandQty = round2(num(r.on_hand_qty));
    const avgCostHkd = round2(num(r.avg_cost));
    const lastCostHkd = round2(num(r.last_cost));
    const sellPriceHkd = round2(num(r.sell_price));
    const sold90dQty = round2(num(r.sold_90d_qty));
    const targetStock = Math.max(reorderMin, sold90dQty);
    const suggestedReorderQty = Math.max(0, Math.ceil(targetStock - onHandQty));
    const reorderUnitCost = lastCostHkd || avgCostHkd;
    return {
      productId: num(r.product_id),
      sku: str(r.barcode),
      ubc: str(r.ubc),
      nameZh: str(r.name_zh),
      nameEn: str(r.name_en),
      categoryC1: num(r.legacy_c1),
      categoryName: str(r.category_name),
      unitName: str(r.unit_name),
      onHandQty,
      avgCostHkd,
      stockValAvgHkd: round2(onHandQty * avgCostHkd),
      lastCostHkd,
      stockValLastHkd: round2(onHandQty * lastCostHkd),
      sellPriceHkd,
      retailValHkd: round2(onHandQty * sellPriceHkd),
      lastSaleDate: r.last_sale_date ? str(r.last_sale_date) : null,
      daysNotSold: r.days_not_sold !== null && r.days_not_sold !== undefined ? num(r.days_not_sold) : null,
      totalSoldQty: round2(num(r.total_sold_qty)),
      sold90dQty,
      reorderLevel: round2(targetStock),
      suggestedReorderQty,
      estReorderCostHkd: round2(suggestedReorderQty * reorderUnitCost),
      updatedAtIso: r.updated_at ? new Date(r.updated_at as string | Date).toISOString() : null,
    };
  });

  const totals = items.reduce(
    (acc, r) => ({
      skuCount: acc.skuCount + 1,
      onHandQty: round2(acc.onHandQty + r.onHandQty),
      stockValAvgHkd: round2(acc.stockValAvgHkd + r.stockValAvgHkd),
      stockValLastHkd: round2(acc.stockValLastHkd + r.stockValLastHkd),
      retailValHkd: round2(acc.retailValHkd + r.retailValHkd),
      suggestedReorderQty: acc.suggestedReorderQty + r.suggestedReorderQty,
      estReorderCostHkd: round2(acc.estReorderCostHkd + r.estReorderCostHkd),
    }),
    {
      skuCount: 0,
      onHandQty: 0,
      stockValAvgHkd: 0,
      stockValLastHkd: 0,
      retailValHkd: 0,
      suggestedReorderQty: 0,
      estReorderCostHkd: 0,
    },
  );

  return {
    subView: params.subView,
    asOfDate: todayHkt,
    rows: items,
    totals,
  };
}

/** Legacy BOS 10407 Stock Movement Report: Opening + In - Out +- Adj/Stk = Closing. */
export async function getStockMovementMatrixReport(params: {
  fromDate: string;
  toDate: string;
  shopId: number;
  categoryC1?: number;
  q?: string;
  activeOnly?: boolean;
}) {
  const { pool } = requireSharedDb();
  const activeOnly = params.activeOnly ?? true;
  const effDateSql = "COALESCE(b.business_date, DATE_FORMAT(sm.created_at, '%Y-%m-%d'))";

  const whereParts = ["p.active = 1"];
  const prodArgs: Array<string | number> = [];
  if (params.categoryC1 !== undefined && Number.isFinite(params.categoryC1)) {
    whereParts.push("p.legacy_c1 = ?");
    prodArgs.push(params.categoryC1);
  }
  const cleanQ = params.q?.trim();
  if (cleanQ) {
    const pat = `%${cleanQ}%`;
    whereParts.push("(p.barcode LIKE ? OR p.ubc LIKE ? OR p.name_zh LIKE ? OR p.name_en LIKE ?)");
    prodArgs.push(pat, pat, pat, pat);
  }

  const args: Array<string | number> = [
    params.toDate,
    params.fromDate,
    params.toDate,
    params.fromDate,
    params.toDate,
    params.fromDate,
    params.toDate,
    params.fromDate,
    params.toDate,
    params.fromDate,
    params.toDate,
    params.fromDate,
    params.toDate,
    params.fromDate,
    params.toDate,
    params.fromDate,
    params.toDate,
    params.fromDate,
    params.toDate,
    params.fromDate,
    params.toDate,
    params.fromDate,
    params.toDate,
    params.shopId,
    params.shopId,
    ...prodArgs,
  ];

  const [rows] = await pool.query<SqlRow[]>(
    `SELECT
      p.id AS product_id,
      p.barcode,
      p.ubc,
      p.name_zh,
      p.name_en,
      p.legacy_c1,
      COALESCE(c.name_zh, CONCAT('C1=', p.legacy_c1)) AS category_name,
      COALESCE(sb.on_hand_qty, 0) AS on_hand_now,
      COALESCE(sb.moving_avg_cost, p.avg_cost, 0) AS avg_cost,
      COALESCE(mv.after_delta, 0) AS after_delta,
      COALESCE(mv.in_grc, 0) AS in_grc,
      COALESCE(mv.in_rtn, 0) AS in_rtn,
      COALESCE(mv.in_tri, 0) AS in_tri,
      COALESCE(mv.out_sale, 0) AS out_sale,
      COALESCE(mv.out_prc, 0) AS out_prc,
      COALESCE(mv.out_tro, 0) AS out_tro,
      COALESCE(mv.out_wof, 0) AS out_wof,
      COALESCE(mv.adj_delta, 0) AS adj_delta,
      COALESCE(mv.stk_delta, 0) AS stk_delta,
      COALESCE(mv.other_delta, 0) AS other_delta,
      COALESCE(mv.net_delta, 0) AS net_delta
    FROM products p
    LEFT JOIN categories c ON c.legacy_c1 = p.legacy_c1
    LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.shop_id = ?
    LEFT JOIN (
      SELECT
        sm.product_id,
        COALESCE(SUM(CASE WHEN ${effDateSql} > ? THEN sm.on_hand_delta ELSE 0 END), 0) AS after_delta,
        COALESCE(SUM(CASE WHEN ${effDateSql} BETWEEN ? AND ? AND sm.movement_type = 'PURCHASE_IN' THEN sm.on_hand_delta ELSE 0 END), 0) AS in_grc,
        COALESCE(SUM(CASE WHEN ${effDateSql} BETWEEN ? AND ? AND sm.movement_type = 'RETURN' THEN sm.on_hand_delta ELSE 0 END), 0) AS in_rtn,
        COALESCE(SUM(CASE WHEN ${effDateSql} BETWEEN ? AND ? AND sm.movement_type = 'TRANSFER_IN' THEN sm.on_hand_delta ELSE 0 END), 0) AS in_tri,
        COALESCE(SUM(CASE WHEN ${effDateSql} BETWEEN ? AND ? AND sm.movement_type = 'SALE' THEN sm.on_hand_delta ELSE 0 END), 0) AS out_sale,
        COALESCE(SUM(CASE WHEN ${effDateSql} BETWEEN ? AND ? AND sm.movement_type = 'PURCHASE_RETURN' THEN sm.on_hand_delta ELSE 0 END), 0) AS out_prc,
        COALESCE(SUM(CASE WHEN ${effDateSql} BETWEEN ? AND ? AND sm.movement_type = 'TRANSFER_OUT' THEN sm.on_hand_delta ELSE 0 END), 0) AS out_tro,
        COALESCE(SUM(CASE WHEN ${effDateSql} BETWEEN ? AND ? AND sm.movement_type = 'WRITE_OFF' THEN sm.on_hand_delta ELSE 0 END), 0) AS out_wof,
        COALESCE(SUM(CASE WHEN ${effDateSql} BETWEEN ? AND ? AND sm.movement_type = 'ADJUST' THEN sm.on_hand_delta ELSE 0 END), 0) AS adj_delta,
        COALESCE(SUM(CASE WHEN ${effDateSql} BETWEEN ? AND ? AND sm.movement_type = 'STOCKTAKE' THEN sm.on_hand_delta ELSE 0 END), 0) AS stk_delta,
        COALESCE(SUM(CASE WHEN ${effDateSql} BETWEEN ? AND ? AND sm.movement_type NOT IN ('PURCHASE_IN','RETURN','TRANSFER_IN','SALE','PURCHASE_RETURN','TRANSFER_OUT','WRITE_OFF','ADJUST','STOCKTAKE') THEN sm.on_hand_delta ELSE 0 END), 0) AS other_delta,
        COALESCE(SUM(CASE WHEN ${effDateSql} BETWEEN ? AND ? THEN sm.on_hand_delta ELSE 0 END), 0) AS net_delta
      FROM stock_movements sm
      LEFT JOIN bills b ON b.id = sm.bill_id
      WHERE sm.shop_id = ?
      GROUP BY sm.product_id
    ) mv ON mv.product_id = p.id
    WHERE ${whereParts.join(" AND ")}
    ORDER BY ABS(COALESCE(mv.net_delta, 0)) DESC, p.legacy_c1 ASC, p.barcode ASC`,
    args,
  );

  const mapped = rows
    .map((r) => {
      const closingQty = round4(num(r.on_hand_now) - num(r.after_delta));
      const netDeltaQty = round4(num(r.net_delta));
      const openingQty = round4(closingQty - netDeltaQty);
      const avgCostHkd = round2(num(r.avg_cost));
      const inGrcQty = round4(num(r.in_grc));
      const inRtnQty = round4(num(r.in_rtn));
      const inTriQty = round4(num(r.in_tri));
      const outSaleQty = round4(num(r.out_sale));
      const outPrcQty = round4(num(r.out_prc));
      const outTroQty = round4(num(r.out_tro));
      const outWofQty = round4(num(r.out_wof));
      const adjQty = round4(num(r.adj_delta) + num(r.other_delta));
      const stkQty = round4(num(r.stk_delta));
      const hasActivity =
        Math.abs(netDeltaQty) > 0 ||
        Math.abs(inGrcQty) > 0 ||
        Math.abs(outSaleQty) > 0 ||
        Math.abs(adjQty) > 0 ||
        Math.abs(stkQty) > 0;
      const nonZeroStock = Math.abs(openingQty) > 0 || Math.abs(closingQty) > 0;

      return {
        productId: num(r.product_id),
        sku: str(r.barcode),
        ubc: str(r.ubc),
        nameZh: str(r.name_zh),
        nameEn: str(r.name_en),
        categoryC1: num(r.legacy_c1),
        categoryName: str(r.category_name),
        openingQty,
        inGrcQty,
        inRtnQty,
        inTriQty,
        outSaleQty,
        outPrcQty,
        outTroQty,
        outWofQty,
        adjQty,
        stkQty,
        netDeltaQty,
        closingQty,
        avgCostHkd,
        closingValHkd: round2(closingQty * avgCostHkd),
        _hasActivity: hasActivity,
        _nonZeroStock: nonZeroStock,
      };
    })
    .filter((r) => (!activeOnly ? true : r._hasActivity || r._nonZeroStock));

  const totals = mapped.reduce(
    (acc, r) => ({
      skuCount: acc.skuCount + 1,
      openingQty: round4(acc.openingQty + r.openingQty),
      inGrcQty: round4(acc.inGrcQty + r.inGrcQty),
      inRtnQty: round4(acc.inRtnQty + r.inRtnQty),
      inTriQty: round4(acc.inTriQty + r.inTriQty),
      outSaleQty: round4(acc.outSaleQty + r.outSaleQty),
      outPrcQty: round4(acc.outPrcQty + r.outPrcQty),
      outTroQty: round4(acc.outTroQty + r.outTroQty),
      outWofQty: round4(acc.outWofQty + r.outWofQty),
      adjQty: round4(acc.adjQty + r.adjQty),
      stkQty: round4(acc.stkQty + r.stkQty),
      netDeltaQty: round4(acc.netDeltaQty + r.netDeltaQty),
      closingQty: round4(acc.closingQty + r.closingQty),
      closingValHkd: round2(acc.closingValHkd + r.closingValHkd),
    }),
    {
      skuCount: 0,
      openingQty: 0,
      inGrcQty: 0,
      inRtnQty: 0,
      inTriQty: 0,
      outSaleQty: 0,
      outPrcQty: 0,
      outTroQty: 0,
      outWofQty: 0,
      adjQty: 0,
      stkQty: 0,
      netDeltaQty: 0,
      closingQty: 0,
      closingValHkd: 0,
    },
  );

  return {
    range: { fromDate: params.fromDate, toDate: params.toDate },
    rows: mapped.slice(0, 2000).map(({ _hasActivity, _nonZeroStock, ...rest }) => rest),
    totals,
  };
}

/** Legacy histheader / histdetail / wfpayment Check Bill & Payment Ledger + AR Aging report. */
export async function getCheckBillLedgerReport(params: {
  fromDate: string;
  toDate: string;
  shopId: number;
  subView: "headers" | "lines" | "payments";
  docType?: string;
  status?: string;
  tenderCode?: string;
  q?: string;
  limit?: number;
}) {
  const { pool } = requireSharedDb();
  const maxRows = Math.min(1000, Math.max(10, params.limit ?? 500));
  const cleanQ = params.q?.trim();

  if (params.subView === "headers") {
    const where = ["b.shop_id = ?", "b.business_date >= ?", "b.business_date <= ?"];
    const args: Array<string | number> = [params.shopId, params.fromDate, params.toDate];
    if (params.docType) {
      where.push("b.doc_type = ?");
      args.push(params.docType);
    }
    if (params.status) {
      where.push("b.status = ?");
      args.push(params.status);
    }
    if (cleanQ) {
      const pat = `%${cleanQ}%`;
      where.push(
        "(b.invoice_no LIKE ? OR COALESCE(c.name_zh, c.name_en, b.legacy_sc, '') LIKE ? OR COALESCE(b.notes, '') LIKE ?)",
      );
      args.push(pat, pat, pat);
    }
    args.push(maxRows);

    const [rows] = await pool.query<SqlRow[]>(
      `SELECT
        s.legacy_sn,
        t.legacy_mn,
        b.invoice_no,
        b.legacy_xc,
        b.doc_type,
        b.business_date,
        DATE_FORMAT(b.issued_at, '%H:%i:%s') AS issued_time,
        COALESCE(NULLIF(c.name_zh, ''), NULLIF(c.name_en, ''), NULLIF(b.legacy_sc, ''), '散客') AS counterparty,
        COALESCE(st.display_name, '-') AS staff_name,
        b.gross_amount,
        b.discount_amount,
        b.net_amount,
        b.paid_amount,
        b.balance_due,
        b.status,
        b.payment_status,
        COALESCE(b.notes, '') AS notes
      FROM bills b
      INNER JOIN shops s ON s.id = b.shop_id
      INNER JOIN terminals t ON t.id = b.terminal_id
      LEFT JOIN customers c ON c.id = b.customer_id
      LEFT JOIN staff st ON st.id = b.staff_id
      WHERE ${where.join(" AND ")}
      ORDER BY b.business_date DESC, b.issued_at DESC, b.id DESC
      LIMIT ?`,
      args,
    );

    const mapped = rows.map((r) => {
      const sign = str(r.doc_type) === "SALES_RETURN" || str(r.doc_type) === "PETTY_PAYOUT" ? -1 : 1;
      const isActive = str(r.status) !== "cancelled" && str(r.status) !== "held";
      const grossHkd = round2(num(r.gross_amount) * sign);
      const discountHkd = round2(num(r.discount_amount) * sign);
      const netHkd = round2(num(r.net_amount) * sign);
      const paidHkd = round2(num(r.paid_amount) * sign);
      const balanceDueHkd = round2(num(r.balance_due));
      return {
        legacySn: num(r.legacy_sn),
        legacyMn: num(r.legacy_mn),
        invoiceNo: str(r.invoice_no),
        legacyXc: num(r.legacy_xc),
        docType: str(r.doc_type),
        businessDate: str(r.business_date),
        issuedTime: str(r.issued_time),
        counterparty: str(r.counterparty),
        staffName: str(r.staff_name),
        grossHkd,
        discountHkd,
        netHkd,
        paidHkd,
        balanceDueHkd,
        status: str(r.status),
        paymentStatus: str(r.payment_status),
        notes: str(r.notes),
        _isActive: isActive,
      };
    });

    const totals = mapped
      .filter((r) => r._isActive)
      .reduce(
        (acc, r) => ({
          count: acc.count + 1,
          grossHkd: round2(acc.grossHkd + r.grossHkd),
          discountHkd: round2(acc.discountHkd + r.discountHkd),
          netHkd: round2(acc.netHkd + r.netHkd),
          paidHkd: round2(acc.paidHkd + r.paidHkd),
          balanceDueHkd: round2(acc.balanceDueHkd + r.balanceDueHkd),
        }),
        { count: 0, grossHkd: 0, discountHkd: 0, netHkd: 0, paidHkd: 0, balanceDueHkd: 0 },
      );

    return {
      subView: "headers" as const,
      range: { fromDate: params.fromDate, toDate: params.toDate },
      rows: mapped.map(({ _isActive, ...rest }) => rest),
      totals,
    };
  }

  if (params.subView === "lines") {
    const where = ["b.shop_id = ?", "b.business_date >= ?", "b.business_date <= ?", "bl.legacy_dk > 0"];
    const args: Array<string | number> = [params.shopId, params.fromDate, params.toDate];
    if (params.docType) {
      where.push("b.doc_type = ?");
      args.push(params.docType);
    }
    if (params.status) {
      where.push("b.status = ?");
      args.push(params.status);
    }
    if (cleanQ) {
      const pat = `%${cleanQ}%`;
      where.push("(b.invoice_no LIKE ? OR bl.sku LIKE ? OR bl.name_zh LIKE ? OR bl.name_en LIKE ?)");
      args.push(pat, pat, pat, pat);
    }
    args.push(maxRows);

    const [rows] = await pool.query<SqlRow[]>(
      `SELECT
        b.business_date,
        DATE_FORMAT(b.issued_at, '%H:%i:%s') AS issued_time,
        b.invoice_no,
        b.legacy_xc,
        b.doc_type,
        b.status,
        bl.line_no,
        bl.sku,
        bl.name_zh,
        bl.name_en,
        bl.category_c1,
        bl.quantity,
        bl.unit_price,
        bl.line_discount_amount,
        bl.line_total,
        bl.cancelled,
        COALESCE(st.display_name, '-') AS staff_name
      FROM bill_lines bl
      INNER JOIN bills b ON b.id = bl.bill_id
      LEFT JOIN staff st ON st.id = b.staff_id
      WHERE ${where.join(" AND ")}
      ORDER BY b.business_date DESC, b.issued_at DESC, bl.line_no ASC
      LIMIT ?`,
      args,
    );

    const mapped = rows.map((r) => {
      const sign = str(r.doc_type) === "SALES_RETURN" || str(r.doc_type) === "PETTY_PAYOUT" ? -1 : 1;
      const qty = round4(num(r.quantity) * sign);
      const unitPriceHkd = round2(num(r.unit_price));
      const lineTotalHkd = round2(num(r.line_total) * sign);
      const discountHkd = round2(qty * unitPriceHkd - lineTotalHkd);
      const cancelled = Boolean(r.cancelled) || str(r.status) === "cancelled";
      return {
        businessDate: str(r.business_date),
        issuedTime: str(r.issued_time),
        invoiceNo: str(r.invoice_no),
        legacyXc: num(r.legacy_xc),
        docType: str(r.doc_type),
        lineNo: num(r.line_no),
        sku: str(r.sku),
        nameZh: str(r.name_zh) || str(r.name_en),
        categoryC1: num(r.category_c1),
        quantity: qty,
        unitPriceHkd,
        discountHkd,
        lineTotalHkd,
        cancelled,
        staffName: str(r.staff_name),
      };
    });

    const active = mapped.filter((r) => !r.cancelled);
    return {
      subView: "lines" as const,
      range: { fromDate: params.fromDate, toDate: params.toDate },
      rows: mapped,
      totals: {
        count: active.length,
        quantity: round2(active.reduce((s, r) => s + r.quantity, 0)),
        discountHkd: round2(active.reduce((s, r) => s + r.discountHkd, 0)),
        lineTotalHkd: round2(active.reduce((s, r) => s + r.lineTotalHkd, 0)),
      },
    };
  }

  // payments + AR aging
  const pmtWhere = [
    "b.shop_id = ?",
    "bp.business_date >= ?",
    "bp.business_date <= ?",
    "bp.voided = 0",
    "b.status NOT IN ('cancelled', 'held')",
  ];
  const pmtArgs: Array<string | number> = [params.shopId, params.fromDate, params.toDate];
  if (params.tenderCode) {
    pmtWhere.push("bp.tender_code = ?");
    pmtArgs.push(params.tenderCode);
  }
  if (cleanQ) {
    const pat = `%${cleanQ}%`;
    pmtWhere.push(
      "(b.invoice_no LIKE ? OR COALESCE(c.name_zh, c.name_en, '') LIKE ? OR COALESCE(bp.approval_code, bp.reference_no, '') LIKE ?)",
    );
    pmtArgs.push(pat, pat, pat);
  }
  pmtArgs.push(maxRows);

  const todayHkt = formatHktBusinessDate();
  const [pmtRows, arBucketRows, openInvoicesRows] = await Promise.all([
    pool.query<SqlRow[]>(
      `SELECT
        bp.business_date,
        DATE_FORMAT(bp.paid_at, '%H:%i:%s') AS paid_time,
        b.invoice_no,
        b.doc_type,
        COALESCE(NULLIF(c.name_zh, ''), NULLIF(c.name_en, ''), '散客') AS customer_name,
        bp.tender_code,
        COALESCE(pm.name_zh, bp.tender_code) AS tender_name_zh,
        COALESCE(pm.legacy_pm, 99) AS legacy_pm,
        bp.amount,
        COALESCE(bp.approval_code, '') AS approval_code,
        COALESCE(bp.card_last4, '') AS card_last4,
        COALESCE(bp.reference_no, '') AS reference_no,
        COALESCE(st.display_name, '-') AS staff_name,
        COALESCE(bp.remarks, '') AS remarks
      FROM bill_payments bp
      INNER JOIN bills b ON b.id = bp.bill_id
      LEFT JOIN pay_methods pm ON pm.code = bp.tender_code
      LEFT JOIN customers c ON c.id = b.customer_id
      LEFT JOIN staff st ON st.id = bp.staff_id
      WHERE ${pmtWhere.join(" AND ")}
      ORDER BY bp.business_date DESC, bp.paid_at DESC, bp.id DESC
      LIMIT ?`,
      pmtArgs,
    ),
    pool.query<SqlRow[]>(
      `SELECT
        CASE
          WHEN DATEDIFF(STR_TO_DATE(?, '%Y-%m-%d'), STR_TO_DATE(b.business_date, '%Y-%m-%d')) <= 30 THEN '0_30'
          WHEN DATEDIFF(STR_TO_DATE(?, '%Y-%m-%d'), STR_TO_DATE(b.business_date, '%Y-%m-%d')) <= 60 THEN '31_60'
          WHEN DATEDIFF(STR_TO_DATE(?, '%Y-%m-%d'), STR_TO_DATE(b.business_date, '%Y-%m-%d')) <= 90 THEN '61_90'
          ELSE 'OVER_90'
        END AS bucket,
        COUNT(*) AS inv_count,
        COALESCE(SUM(b.balance_due), 0) AS total_due
      FROM bills b
      WHERE b.shop_id = ?
        AND b.status NOT IN ('cancelled', 'held')
        AND b.payment_status IN ('unpaid', 'partial')
        AND b.balance_due > 0
      GROUP BY bucket`,
      [todayHkt, todayHkt, todayHkt, params.shopId],
    ),
    pool.query<SqlRow[]>(
      `SELECT
        b.invoice_no,
        b.business_date,
        COALESCE(NULLIF(c.name_zh, ''), NULLIF(c.name_en, ''), '散客') AS customer_name,
        b.net_amount,
        b.paid_amount,
        b.balance_due,
        GREATEST(0, DATEDIFF(STR_TO_DATE(?, '%Y-%m-%d'), STR_TO_DATE(b.business_date, '%Y-%m-%d'))) AS age_days
      FROM bills b
      LEFT JOIN customers c ON c.id = b.customer_id
      WHERE b.shop_id = ?
        AND b.status NOT IN ('cancelled', 'held')
        AND b.payment_status IN ('unpaid', 'partial')
        AND b.balance_due > 0
      ORDER BY age_days DESC, b.balance_due DESC
      LIMIT 60`,
      [todayHkt, params.shopId],
    ),
  ]);

  const payments = pmtRows[0].map((r) => {
    const sign = str(r.doc_type) === "SALES_RETURN" || str(r.doc_type) === "PETTY_PAYOUT" ? -1 : 1;
    return {
      businessDate: str(r.business_date),
      paidTime: str(r.paid_time),
      invoiceNo: str(r.invoice_no),
      docType: str(r.doc_type),
      customerName: str(r.customer_name),
      tenderCode: str(r.tender_code),
      tenderNameZh: str(r.tender_name_zh),
      legacyPm: num(r.legacy_pm),
      amountHkd: round2(num(r.amount) * sign),
      approvalCode: str(r.approval_code),
      cardLast4: str(r.card_last4),
      referenceNo: str(r.reference_no),
      staffName: str(r.staff_name),
      remarks: str(r.remarks),
    };
  });

  const subByTender = new Map<string, { tenderCode: string; tenderNameZh: string; legacyPm: number; txCount: number; amountHkd: number }>();
  for (const p of payments) {
    const cur = subByTender.get(p.tenderCode) ?? {
      tenderCode: p.tenderCode,
      tenderNameZh: p.tenderNameZh,
      legacyPm: p.legacyPm,
      txCount: 0,
      amountHkd: 0,
    };
    cur.txCount += 1;
    cur.amountHkd = round2(cur.amountHkd + p.amountHkd);
    subByTender.set(p.tenderCode, cur);
  }

  const bucketLabels: Array<[string, string]> = [
    ["0_30", "0 - 30 日"],
    ["31_60", "31 - 60 日"],
    ["61_90", "61 - 90 日"],
    ["OVER_90", "90 日以上"],
  ];
  const arMap = new Map(arBucketRows[0].map((r) => [str(r.bucket), r]));
  const arAgingBuckets = bucketLabels.map(([key, label]) => ({
    bucket: key,
    label,
    invoiceCount: num(arMap.get(key)?.inv_count),
    balanceDueHkd: round2(num(arMap.get(key)?.total_due)),
  }));

  return {
    subView: "payments" as const,
    range: { fromDate: params.fromDate, toDate: params.toDate },
    rows: payments,
    tenderSubTotals: Array.from(subByTender.values()).sort((a, b) => a.legacyPm - b.legacyPm),
    arAgingBuckets,
    openInvoices: openInvoicesRows[0].map((r) => ({
      invoiceNo: str(r.invoice_no),
      businessDate: str(r.business_date),
      customerName: str(r.customer_name),
      netHkd: round2(num(r.net_amount)),
      paidHkd: round2(num(r.paid_amount)),
      balanceDueHkd: round2(num(r.balance_due)),
      ageDays: num(r.age_days),
    })),
    totals: {
      count: payments.length,
      amountHkd: round2(payments.reduce((s, r) => s + r.amountHkd, 0)),
      totalArDueHkd: round2(arAgingBuckets.reduce((s, b) => s + b.balanceDueHkd, 0)),
      totalArInvoices: arAgingBuckets.reduce((s, b) => s + b.invoiceCount, 0),
    },
  };
}

/** Legacy OfficeXHeader / OfficeXDetail / fmstocktakelist report. */
export async function getOtherTransactionsReport(params: {
  fromDate: string;
  toDate: string;
  shopId: number;
  subView: "headers" | "lines" | "stocktake";
  docType?: string;
  q?: string;
}) {
  const { pool } = requireSharedDb();
  const cleanQ = params.q?.trim();

  if (params.subView === "stocktake") {
    const where = ["st.shop_id = ?", "DATE_FORMAT(DATE_ADD(st.snapshot_date, INTERVAL 8 HOUR), '%Y-%m-%d') BETWEEN ? AND ?"];
    const args: Array<string | number> = [params.shopId, params.fromDate, params.toDate];
    if (cleanQ) {
      const pat = `%${cleanQ}%`;
      where.push("(p.barcode LIKE ? OR p.ubc LIKE ? OR p.name_zh LIKE ?)");
      args.push(pat, pat, pat);
    }
    const [rows] = await pool.query<SqlRow[]>(
      `SELECT
        stl.stock_take_id,
        st.snapshot_date,
        COALESCE(sf.display_name, '-') AS staff_name,
        p.barcode,
        p.ubc,
        COALESCE(NULLIF(p.name_zh, ''), p.name_en) AS product_name,
        p.legacy_c1,
        stl.expected_qty,
        stl.counted_qty,
        COALESCE(sb.moving_avg_cost, p.avg_cost, 0) AS avg_cost
      FROM stock_take_lines stl
      INNER JOIN stock_takes st ON st.id = stl.stock_take_id
      INNER JOIN products p ON p.id = stl.product_id
      LEFT JOIN staff sf ON sf.id = st.staff_id
      LEFT JOIN stock_balances sb ON sb.product_id = p.id AND sb.shop_id = st.shop_id
      WHERE ${where.join(" AND ")}
      ORDER BY st.snapshot_date DESC, stl.id DESC
      LIMIT 600`,
      args,
    );

    const mapped = rows.map((r) => {
      const expectedQty = round2(num(r.expected_qty));
      const countedQty = round2(num(r.counted_qty));
      const diffQty = round2(countedQty - expectedQty);
      const avgCost = round2(num(r.avg_cost));
      return {
        stockTakeId: num(r.stock_take_id),
        snapshotDateIso: new Date(r.snapshot_date as string | Date).toISOString(),
        staffName: str(r.staff_name),
        sku: str(r.barcode),
        ubc: str(r.ubc),
        productName: str(r.product_name),
        categoryC1: num(r.legacy_c1),
        expectedQty,
        countedQty,
        diffQty,
        varianceValHkd: round2(diffQty * avgCost),
      };
    });

    return {
      subView: "stocktake" as const,
      range: { fromDate: params.fromDate, toDate: params.toDate },
      rows: mapped,
      totals: {
        count: mapped.length,
        expectedQty: round2(mapped.reduce((s, r) => s + r.expectedQty, 0)),
        countedQty: round2(mapped.reduce((s, r) => s + r.countedQty, 0)),
        diffQty: round2(mapped.reduce((s, r) => s + r.diffQty, 0)),
        varianceValHkd: round2(mapped.reduce((s, r) => s + r.varianceValHkd, 0)),
      },
    };
  }

  const officeFilter = params.docType
    ? "b.doc_type = ?"
    : `(b.doc_type IN (${OFFICE_DOC_TYPES_SQL}) OR b.source_table = 'OfficeXHeader')`;
  const where = ["b.shop_id = ?", "b.business_date >= ?", "b.business_date <= ?", "b.status <> 'held'", officeFilter];
  const args: Array<string | number> = [params.shopId, params.fromDate, params.toDate];
  if (params.docType) args.push(params.docType);

  if (params.subView === "headers") {
    if (cleanQ) {
      const pat = `%${cleanQ}%`;
      where.push("(b.invoice_no LIKE ? OR COALESCE(b.legacy_sc, '') LIKE ? OR COALESCE(b.notes, '') LIKE ?)");
      args.push(pat, pat, pat);
    }
    const [rows] = await pool.query<SqlRow[]>(
      `SELECT
        b.invoice_no,
        b.doc_type,
        b.legacy_xc,
        b.business_date,
        DATE_FORMAT(b.issued_at, '%H:%i:%s') AS issued_time,
        COALESCE(sup.name_zh, NULLIF(b.legacy_sc, ''), '-') AS counterparty,
        COALESCE(b.legacy_sc, '') AS supplier_code,
        COALESCE(st.display_name, '-') AS staff_name,
        b.net_amount,
        b.status,
        COALESCE(b.notes, '') AS notes
      FROM bills b
      LEFT JOIN suppliers sup ON sup.legacy_id = b.legacy_sc
      LEFT JOIN staff st ON st.id = b.staff_id
      WHERE ${where.join(" AND ")}
      ORDER BY b.business_date DESC, b.id DESC
      LIMIT 600`,
      args,
    );

    const mapped = rows.map((r) => {
      const code = str(r.doc_type);
      const meta = DOC_TYPE_META[code];
      return {
        invoiceNo: str(r.invoice_no),
        docType: code,
        docTypeLabel: meta?.zh ?? code,
        legacyXc: num(r.legacy_xc),
        businessDate: str(r.business_date),
        issuedTime: str(r.issued_time),
        supplierCode: str(r.supplier_code),
        counterparty: str(r.counterparty),
        staffName: str(r.staff_name),
        totalAmountHkd: round2(num(r.net_amount)),
        status: str(r.status),
        notes: str(r.notes),
      };
    });

    const active = mapped.filter((r) => r.status !== "cancelled");
    return {
      subView: "headers" as const,
      range: { fromDate: params.fromDate, toDate: params.toDate },
      rows: mapped,
      totals: {
        count: active.length,
        totalAmountHkd: round2(active.reduce((s, r) => s + r.totalAmountHkd, 0)),
      },
    };
  }

  // subView === "lines"
  if (cleanQ) {
    const pat = `%${cleanQ}%`;
    where.push("(b.invoice_no LIKE ? OR bl.sku LIKE ? OR bl.name_zh LIKE ? OR COALESCE(b.legacy_sc, '') LIKE ?)");
    args.push(pat, pat, pat, pat);
  }
  const [rows] = await pool.query<SqlRow[]>(
    `SELECT
      b.business_date,
      b.invoice_no,
      b.doc_type,
      b.legacy_xc,
      b.status,
      bl.line_no,
      bl.sku,
      bl.name_zh,
      bl.quantity,
      bl.unit_price,
      bl.line_total,
      COALESCE(sup.name_zh, NULLIF(b.legacy_sc, ''), '-') AS counterparty,
      COALESCE(st.display_name, '-') AS staff_name,
      COALESCE(b.notes, '') AS notes
    FROM bill_lines bl
    INNER JOIN bills b ON b.id = bl.bill_id
    LEFT JOIN suppliers sup ON sup.legacy_id = b.legacy_sc
    LEFT JOIN staff st ON st.id = b.staff_id
    WHERE ${where.join(" AND ")}
    ORDER BY b.business_date DESC, b.id DESC, bl.line_no ASC
    LIMIT 800`,
    args,
  );

  const mapped = rows.map((r) => ({
    businessDate: str(r.business_date),
    invoiceNo: str(r.invoice_no),
    docType: str(r.doc_type),
    legacyXc: num(r.legacy_xc),
    lineNo: num(r.line_no),
    sku: str(r.sku),
    nameZh: str(r.name_zh),
    quantity: round2(num(r.quantity)),
    unitPriceHkd: round2(num(r.unit_price)),
    lineTotalHkd: round2(num(r.line_total)),
    counterparty: str(r.counterparty),
    staffName: str(r.staff_name),
    status: str(r.status),
    notes: str(r.notes),
  }));

  const active = mapped.filter((r) => r.status !== "cancelled");
  return {
    subView: "lines" as const,
    range: { fromDate: params.fromDate, toDate: params.toDate },
    rows: mapped,
    totals: {
      count: active.length,
      quantity: round2(active.reduce((s, r) => s + r.quantity, 0)),
      lineTotalHkd: round2(active.reduce((s, r) => s + r.lineTotalHkd, 0)),
    },
  };
}

/** Legacy Manager Stats (member, staffinfo, docType, supplier summary, activit audit log). */
export async function getManagerStatsReport(params: { fromDate: string; toDate: string; shopId: number }) {
  const { pool } = requireSharedDb();
  const baseParams = [params.shopId, params.fromDate, params.toDate];

  const [custRows, staffRows, docRows, supHdrRows, supLineRows, auditRangeRows, auditFallbackRows] =
    await Promise.all([
      pool.query<SqlRow[]>(
        `SELECT
          c.id AS customer_id,
          c.legacy_id,
          c.name_zh,
          c.name_en,
          c.phone,
          COALESCE(cg.name_zh, '-') AS grade_name,
          c.points_balance,
          COUNT(*) AS bill_count,
          MAX(b.business_date) AS last_visit_date,
          COALESCE(SUM(CASE WHEN b.doc_type = 'SALES_RETURN' THEN -b.net_amount ELSE b.net_amount END), 0) AS net_spend
        FROM bills b
        INNER JOIN customers c ON c.id = b.customer_id
        LEFT JOIN customer_grades cg ON cg.id = c.grade_id
        WHERE b.shop_id = ?
          AND b.business_date >= ?
          AND b.business_date <= ?
          AND b.status NOT IN ('cancelled', 'held')
          AND b.doc_type IN (${SALES_DOC_TYPES_SQL})
        GROUP BY c.id, c.legacy_id, c.name_zh, c.name_en, c.phone, cg.name_zh, c.points_balance
        ORDER BY net_spend DESC
        LIMIT 100`,
        baseParams,
      ),
      pool.query<SqlRow[]>(
        `SELECT
          COALESCE(b.staff_id, 0) AS staff_id,
          COALESCE(sf.legacy_id, 'N/A') AS legacy_id,
          COALESCE(sf.display_name, 'Unassigned') AS display_name,
          SUM(CASE WHEN b.status NOT IN ('cancelled', 'held') THEN 1 ELSE 0 END) AS bill_count,
          SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END) AS void_count,
          COALESCE(SUM(CASE WHEN b.status NOT IN ('cancelled', 'held') THEN (CASE WHEN b.doc_type = 'SALES_RETURN' THEN -b.gross_amount ELSE b.gross_amount END) ELSE 0 END), 0) AS gross_sales,
          COALESCE(SUM(CASE WHEN b.status NOT IN ('cancelled', 'held') THEN (CASE WHEN b.doc_type = 'SALES_RETURN' THEN -b.discount_amount ELSE b.discount_amount END) ELSE 0 END), 0) AS discounts,
          COALESCE(SUM(CASE WHEN b.status NOT IN ('cancelled', 'held') AND b.doc_type = 'SALES_RETURN' THEN b.net_amount ELSE 0 END), 0) AS return_amt,
          COALESCE(SUM(CASE WHEN b.status NOT IN ('cancelled', 'held') THEN (CASE WHEN b.doc_type = 'SALES_RETURN' THEN -b.net_amount ELSE b.net_amount END) ELSE 0 END), 0) AS net_sales
        FROM bills b
        LEFT JOIN staff sf ON sf.id = b.staff_id
        WHERE b.shop_id = ?
          AND b.business_date >= ?
          AND b.business_date <= ?
          AND b.status <> 'held'
          AND b.doc_type IN (${SALES_DOC_TYPES_SQL})
        GROUP BY COALESCE(b.staff_id, 0), COALESCE(sf.legacy_id, 'N/A'), COALESCE(sf.display_name, 'Unassigned')
        ORDER BY net_sales DESC`,
        baseParams,
      ),
      pool.query<SqlRow[]>(
        `SELECT
          b.doc_type,
          MAX(b.legacy_xc) AS legacy_xc,
          COUNT(*) AS doc_count,
          COALESCE(SUM(b.net_amount), 0) AS total_amount,
          COALESCE(SUM(CASE WHEN b.doc_type IN ('SALES_RETURN', 'PURCHASE_RETURN', 'WRITE_OFF', 'PETTY_PAYOUT') THEN -b.net_amount ELSE b.net_amount END), 0) AS signed_amount
        FROM bills b
        WHERE b.shop_id = ?
          AND b.business_date >= ?
          AND b.business_date <= ?
          AND b.status NOT IN ('cancelled', 'held')
        GROUP BY b.doc_type
        ORDER BY doc_count DESC`,
        baseParams,
      ),
      pool.query<SqlRow[]>(
        `SELECT
          s.legacy_id,
          s.name_zh,
          s.name_en,
          s.phone,
          SUM(CASE WHEN b.doc_type = 'GOODS_RECEIPT' THEN 1 ELSE 0 END) AS grc_count,
          COALESCE(SUM(CASE WHEN b.doc_type = 'GOODS_RECEIPT' THEN b.net_amount ELSE 0 END), 0) AS purchase_hkd,
          SUM(CASE WHEN b.doc_type = 'PURCHASE_RETURN' THEN 1 ELSE 0 END) AS prc_count,
          COALESCE(SUM(CASE WHEN b.doc_type = 'PURCHASE_RETURN' THEN b.net_amount ELSE 0 END), 0) AS return_hkd
        FROM suppliers s
        LEFT JOIN bills b
          ON b.legacy_sc = s.legacy_id
          AND b.shop_id = ?
          AND b.business_date >= ?
          AND b.business_date <= ?
          AND b.status NOT IN ('cancelled', 'held')
          AND b.doc_type IN ('GOODS_RECEIPT', 'PURCHASE_RETURN')
        GROUP BY s.legacy_id, s.name_zh, s.name_en, s.phone
        ORDER BY (purchase_hkd - return_hkd) DESC, grc_count DESC, s.legacy_id ASC
        LIMIT 120`,
        baseParams,
      ),
      pool.query<SqlRow[]>(
        `SELECT
          b.legacy_sc AS supplier_id,
          COALESCE(SUM(CASE WHEN b.doc_type = 'GOODS_RECEIPT' THEN bl.quantity ELSE -bl.quantity END), 0) AS net_qty
        FROM bill_lines bl
        INNER JOIN bills b ON b.id = bl.bill_id
        WHERE b.shop_id = ?
          AND b.business_date >= ?
          AND b.business_date <= ?
          AND b.status NOT IN ('cancelled', 'held')
          AND b.doc_type IN ('GOODS_RECEIPT', 'PURCHASE_RETURN')
          AND b.legacy_sc IS NOT NULL
          AND b.legacy_sc <> ''
        GROUP BY b.legacy_sc`,
        baseParams,
      ),
      pool.query<SqlRow[]>(
        `SELECT
          al.id,
          al.action,
          al.entity_type,
          al.entity_id,
          al.details,
          al.created_at,
          COALESCE(sf.legacy_id, '-') AS staff_code,
          COALESCE(sf.display_name, 'SYSTEM') AS staff_name
        FROM audit_logs al
        LEFT JOIN staff sf ON sf.id = al.staff_id
        WHERE al.shop_id = ?
          AND DATE_FORMAT(DATE_ADD(al.created_at, INTERVAL 8 HOUR), '%Y-%m-%d') BETWEEN ? AND ?
        ORDER BY al.id DESC
        LIMIT 150`,
        baseParams,
      ),
      pool.query<SqlRow[]>(
        `SELECT
          al.id,
          al.action,
          al.entity_type,
          al.entity_id,
          al.details,
          al.created_at,
          COALESCE(sf.legacy_id, '-') AS staff_code,
          COALESCE(sf.display_name, 'SYSTEM') AS staff_name
        FROM audit_logs al
        LEFT JOIN staff sf ON sf.id = al.staff_id
        WHERE al.shop_id = ?
        ORDER BY al.id DESC
        LIMIT 100`,
        [params.shopId],
      ),
    ]);

  const supQtyById = new Map(supLineRows[0].map((r) => [str(r.supplier_id), round2(num(r.net_qty))]));
  const rawAudits = auditRangeRows[0].length > 0 ? auditRangeRows[0] : auditFallbackRows[0];

  return {
    range: { fromDate: params.fromDate, toDate: params.toDate },
    customerStats: custRows[0].map((r) => {
      const billCount = num(r.bill_count);
      const netSpendHkd = round2(num(r.net_spend));
      return {
        customerId: num(r.customer_id),
        legacyId: str(r.legacy_id),
        nameZh: str(r.name_zh),
        nameEn: str(r.name_en),
        phone: str(r.phone),
        gradeName: str(r.grade_name),
        pointsBalance: num(r.points_balance),
        billCount,
        netSpendHkd,
        avgBillHkd: billCount ? round2(netSpendHkd / billCount) : 0,
        lastVisitDate: str(r.last_visit_date),
      };
    }),
    staffStats: staffRows[0].map((r) => ({
      staffId: num(r.staff_id),
      legacyId: str(r.legacy_id),
      displayName: str(r.display_name),
      billCount: num(r.bill_count),
      voidCount: num(r.void_count),
      grossSalesHkd: round2(num(r.gross_sales)),
      discountsHkd: round2(num(r.discounts)),
      returnHkd: round2(num(r.return_amt)),
      netSalesHkd: round2(num(r.net_sales)),
    })),
    docTypeStats: docRows[0].map((r) => {
      const code = str(r.doc_type);
      const meta = DOC_TYPE_META[code];
      return {
        docType: code,
        docTypeLabel: meta?.zh ?? code,
        legacyXc: num(r.legacy_xc),
        docCount: num(r.doc_count),
        totalAmountHkd: round2(num(r.total_amount)),
        signedAmountHkd: round2(num(r.signed_amount)),
      };
    }),
    supplierStats: supHdrRows[0].map((r) => {
      const legacyId = str(r.legacy_id);
      const purchaseHkd = round2(num(r.purchase_hkd));
      const returnHkd = round2(num(r.return_hkd));
      return {
        legacyId,
        nameZh: str(r.name_zh),
        nameEn: str(r.name_en),
        phone: str(r.phone),
        grcCount: num(r.grc_count),
        prcCount: num(r.prc_count),
        netQty: supQtyById.get(legacyId) ?? 0,
        purchaseHkd,
        returnHkd,
        netPurchaseHkd: round2(purchaseHkd - returnHkd),
      };
    }),
    activityLogs: rawAudits.map((r) => ({
      id: num(r.id),
      action: str(r.action),
      entityType: str(r.entity_type),
      entityId: str(r.entity_id),
      staffCode: str(r.staff_code),
      staffName: str(r.staff_name),
      detailsSummary: r.details ? (typeof r.details === "string" ? r.details : JSON.stringify(r.details)) : "",
      createdAtIso: new Date(r.created_at as string | Date).toISOString(),
    })),
  };
}
