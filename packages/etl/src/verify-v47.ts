import mysql from "mysql2/promise";
import { validateDatabaseUrl } from "@hkharp/db";
import { getDefaultLegacyConfig, querySqlcmdJson } from "./mssql-read";
import { LEGACY_PAY_METHOD_MAP } from "./pay-method-map";

async function main() {
  const parsedUrl = validateDatabaseUrl(process.env.DATABASE_URL);
  const legacy = getDefaultLegacyConfig();
  const conn = await mysql.createConnection({ uri: parsedUrl.toString(), timezone: "+08:00" });

  try {
    const [mssqlMaster] = await querySqlcmdJson<{
      products: number;
      customers: number;
      suppliers: number;
      staff: number;
      crm_rules: number;
      pos_menu_buttons: number;
    }>(
      legacy.server,
      legacy.gsDatabase,
      `SELECT
        (SELECT COUNT(*) FROM dbo.ProductOnSale) AS products,
        (SELECT COUNT(*) FROM dbo.SCPartyDetail) AS customers,
        (SELECT COUNT(*) FROM dbo.StaffCounterparty WHERE RTRIM(TP)='1') AS suppliers,
        (SELECT COUNT(*) FROM dbo.StaffCounterparty WHERE RTRIM(TP)='0') AS staff,
        (SELECT COUNT(*) FROM dbo.CRMRule) AS crm_rules,
        (SELECT COUNT(*) FROM dbo.Menu) AS pos_menu_buttons`,
    );

    const [mssqlGx] = await querySqlcmdJson<{
      hist_header: number;
      office_only: number;
      hist_detail: number;
      office_detail_only: number;
      bill_payments_non_dlybal: number;
      batch_header: number;
    }>(
      legacy.server,
      legacy.gxDatabase,
      `SELECT
        (SELECT COUNT(*) FROM dbo.HistHeader) AS hist_header,
        (SELECT COUNT(*) FROM dbo.OfficeXHeader O WHERE NOT EXISTS (SELECT 1 FROM dbo.HistHeader H WHERE H.RL=O.RL)) AS office_only,
        (SELECT COUNT(*) FROM dbo.HistDetail) AS hist_detail,
        (SELECT COUNT(*) FROM dbo.OfficeXDetail D WHERE NOT EXISTS (SELECT 1 FROM dbo.HistHeader H WHERE H.RL=D.RL)) AS office_detail_only,
        (SELECT COUNT(*) FROM dbo.HistPayment WHERE PM <> 8) AS bill_payments_non_dlybal,
        (SELECT COUNT(*) FROM dbo.BatchHeader) AS batch_header`,
    );

    const [mysqlCountsRaw] = await conn.query(
      `SELECT
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT COUNT(*) FROM customers) AS customers,
        (SELECT COUNT(*) FROM suppliers) AS suppliers,
        (SELECT COUNT(*) FROM staff) AS staff,
        (SELECT COUNT(*) FROM crm_rules) AS crm_rules,
        (SELECT COUNT(*) FROM pos_menu_buttons) AS pos_menu_buttons,
        (SELECT COUNT(*) FROM bills WHERE source_table='HistHeader') AS hist_header,
        (SELECT COUNT(*) FROM bills WHERE source_table='OfficeXHeader') AS office_only,
        (SELECT COUNT(*) FROM bill_lines) AS total_lines,
        (SELECT COUNT(*) FROM bill_payments) AS bill_payments_non_dlybal,
        (SELECT COUNT(*) FROM day_end_batches) AS batch_header`,
    );
    const mc = (mysqlCountsRaw as Array<Record<string, number>>)[0]!;

    const countPairs: Array<{ metric: string; mssql: number; mysql: number }> = [
      { metric: "products", mssql: mssqlMaster!.products, mysql: Number(mc.products) },
      { metric: "customers", mssql: mssqlMaster!.customers, mysql: Number(mc.customers) },
      { metric: "suppliers", mssql: mssqlMaster!.suppliers, mysql: Number(mc.suppliers) },
      { metric: "staff", mssql: mssqlMaster!.staff, mysql: Number(mc.staff) },
      { metric: "crm_rules", mssql: mssqlMaster!.crm_rules, mysql: Number(mc.crm_rules) },
      { metric: "pos_menu_buttons", mssql: mssqlMaster!.pos_menu_buttons, mysql: Number(mc.pos_menu_buttons) },
      { metric: "bills_hist_header", mssql: mssqlGx!.hist_header, mysql: Number(mc.hist_header) },
      { metric: "bills_office_only", mssql: mssqlGx!.office_only, mysql: Number(mc.office_only) },
      {
        metric: "bill_lines_total",
        mssql: mssqlGx!.hist_detail + mssqlGx!.office_detail_only,
        mysql: Number(mc.total_lines),
      },
      {
        metric: "bill_payments_excl_dlybal",
        mssql: mssqlGx!.bill_payments_non_dlybal,
        mysql: Number(mc.bill_payments_non_dlybal),
      },
      { metric: "day_end_batches", mssql: mssqlGx!.batch_header, mysql: Number(mc.batch_header) },
    ];

    const mssqlYearlyNa = await querySqlcmdJson<{ yr: number; sum_na: number }>(
      legacy.server,
      legacy.gxDatabase,
      "SELECT YEAR(BD) AS yr, CAST(SUM(NA) AS DECIMAL(18,2)) AS sum_na FROM dbo.HistHeader WHERE CF = 0 GROUP BY YEAR(BD) ORDER BY yr",
    );
    const [mysqlYearlyNaRaw] = await conn.query(
      "SELECT CAST(SUBSTRING(business_date, 1, 4) AS UNSIGNED) AS yr, ROUND(SUM(net_amount), 2) AS sum_na FROM bills WHERE source_table='HistHeader' AND status <> 'cancelled' GROUP BY yr ORDER BY yr",
    );
    const mysqlNaByYear = new Map<number, number>(
      (mysqlYearlyNaRaw as Array<{ yr: number; sum_na: string }>).map((r) => [Number(r.yr), Number(r.sum_na)]),
    );

    const yearlyNaDiffs = mssqlYearlyNa.map((r) => {
      const mVal = mysqlNaByYear.get(r.yr) ?? 0;
      const delta = Number((mVal - r.sum_na).toFixed(2));
      return { year: r.yr, mssql: r.sum_na, mysql: mVal, delta };
    });

    const mssqlTenderSums = await querySqlcmdJson<{ PM: number; sum_pa: number }>(
      legacy.server,
      legacy.gxDatabase,
      "SELECT PM, CAST(SUM(PA) AS DECIMAL(18,2)) AS sum_pa FROM dbo.HistPayment WHERE CA = 0 AND PM <> 8 GROUP BY PM ORDER BY PM",
    );
    const [mysqlTenderSumsRaw] = await conn.query(
      "SELECT tender_code, ROUND(SUM(amount), 2) AS sum_pa FROM bill_payments WHERE voided = 0 GROUP BY tender_code",
    );
    const mysqlByTender = new Map<string, number>(
      (mysqlTenderSumsRaw as Array<{ tender_code: string; sum_pa: string }>).map((r) => [r.tender_code, Number(r.sum_pa)]),
    );

    const tenderDiffs = mssqlTenderSums.map((r) => {
      const mapped = LEGACY_PAY_METHOD_MAP[r.PM]!;
      const code = mapped.tenderCode!;
      const mVal = mysqlByTender.get(code) ?? 0;
      return {
        legacyPm: r.PM,
        tenderCode: code,
        mssql: r.sum_pa,
        mysql: mVal,
        delta: Number((mVal - r.sum_pa).toFixed(2)),
      };
    });

    const allCountsExact = countPairs.every((c) => c.mssql === c.mysql);
    const allNaExact = yearlyNaDiffs.every((y) => Math.abs(y.delta) <= 0.05);
    const allTendersWithinTol = tenderDiffs.every((t) => Math.abs(t.delta) <= 0.15);

    console.log(
      JSON.stringify(
        {
          ok: allCountsExact && allNaExact && allTendersWithinTol,
          allCountsExact,
          allNaExact,
          allTendersWithinTol,
          countPairs: countPairs.map((c) => ({ ...c, delta: c.mysql - c.mssql })),
          yearlyNaDiffs,
          tenderDiffs,
        },
        null,
        2,
      ),
    );

    if (!allCountsExact || !allNaExact || !allTendersWithinTol) {
      process.exitCode = 1;
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("V47 verification failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
