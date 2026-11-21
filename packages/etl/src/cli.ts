import { getDefaultLegacyConfig, querySqlcmdRows } from "./mssql-read";
import { mapLegacyPayMethod } from "./pay-method-map";

async function main() {
  const cfg = getDefaultLegacyConfig();

  const dbStateRows = await querySqlcmdRows(
    cfg.server,
    `SELECT name, state_desc, CAST(is_read_only AS INT) FROM sys.databases WHERE name IN ('${cfg.gsDatabase}', '${cfg.gxDatabase}') ORDER BY name;`,
  );

  const countRows = await querySqlcmdRows(
    cfg.server,
    `SELECT 'products', COUNT(*) FROM ${cfg.gsDatabase}.dbo.ProductOnSale
     UNION ALL SELECT 'customers', COUNT(*) FROM ${cfg.gsDatabase}.dbo.SCPartyDetail
     UNION ALL SELECT 'crm_rules', COUNT(*) FROM ${cfg.gsDatabase}.dbo.CRMRule WHERE ENABLED=1
     UNION ALL SELECT 'hist_header', COUNT(*) FROM ${cfg.gxDatabase}.dbo.HistHeader
     UNION ALL SELECT 'hist_detail', COUNT(*) FROM ${cfg.gxDatabase}.dbo.HistDetail
     UNION ALL SELECT 'hist_payment', COUNT(*) FROM ${cfg.gxDatabase}.dbo.HistPayment
     UNION ALL SELECT 'office_x_header', COUNT(*) FROM ${cfg.gxDatabase}.dbo.OfficeXHeader
     UNION ALL SELECT 'batch_header', COUNT(*) FROM ${cfg.gxDatabase}.dbo.BatchHeader;`,
  );

  const pmRows = await querySqlcmdRows(
    cfg.server,
    `SELECT PM, COUNT(*), CAST(SUM(PA) AS DECIMAL(18,2))
     FROM ${cfg.gxDatabase}.dbo.HistPayment
     WHERE CA=0 AND PD >= '2026-01-01'
     GROUP BY PM
     ORDER BY SUM(PA) DESC;`,
  );

  const summary = {
    sourceServer: cfg.server,
    databases: dbStateRows.map(([name, state, ro]) => ({
      name,
      state,
      readOnly: ro === "1",
    })),
    legacyCounts: Object.fromEntries(countRows.map(([k, v]) => [k, Number(v)])),
    tenders2026Mapped: pmRows.map(([pmStr, cntStr, sumStr]) => {
      const pm = Number(pmStr);
      const mapped = mapLegacyPayMethod(pm);
      return {
        legacyPm: pm,
        targetTenderCode: mapped.tenderCode ?? "RETIRED_DLYBAL",
        targetNameEn: mapped.nameEn,
        txCount2026: Number(cntStr),
        totalHkd2026: Number(sumStr),
      };
    }),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("ETL audit failed:", err);
  process.exitCode = 1;
});
