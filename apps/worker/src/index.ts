import { getDashboardSummary, getDayEndPreview, pingMySqlHealth } from "@hkharp/db";
import { getDefaultLegacyConfig } from "@hkharp/etl";

export interface NightlyJobConfig {
  shopId: number;
  terminalId: number;
  rwlUploadDir: string;
  osdxcExePath: string;
  bridgeUrl: string;
}

export function getDefaultWorkerConfig(): NightlyJobConfig {
  return {
    shopId: Number(process.env.SHOP_ID ?? "1"),
    terminalId: Number(process.env.TERMINAL_ID ?? "1"),
    rwlUploadDir: process.env.OCTOPUS_UPLOAD_DIR ?? "C:\\RWL\\Upload",
    osdxcExePath:
      process.env.OCTOPUS_OSDXC_EXE ??
      "C:\\Program Files\\Octopus Cards Ltd\\Octopus Secure Data Exchange Client\\OSDXC.exe",
    bridgeUrl: process.env.NEXT_PUBLIC_HARDWARE_BRIDGE_URL ?? "http://127.0.0.1:17880",
  };
}

export async function runWorkerCheck() {
  const legacy = getDefaultLegacyConfig();
  const cfg = getDefaultWorkerConfig();
  const health = await pingMySqlHealth();
  const summary = health.connected ? await getDashboardSummary() : null;
  const eod = summary ? await getDayEndPreview(summary.todayBusinessDate) : null;

  return {
    service: "@hkharp/worker",
    timezone: process.env.APP_TIMEZONE ?? "Asia/Hong_Kong",
    shopId: cfg.shopId,
    terminalId: cfg.terminalId,
    mysql: health,
    liveSummary: summary,
    latestBatch: eod?.recentBatches[0] ?? null,
    scheduledTasks: [
      {
        id: "day-end-ar-reconciliation",
        description:
          "Reconcile daily issued sales (issued_at) vs collected Bank Transfer (PM=5) & Cheque (PM=7) receipts (paid_at)",
      },
      {
        id: "octopus-xfile-osdxc",
        description: `Trigger local x86 bridge XFile generation to ${cfg.rwlUploadDir} and invoke OSDXC.exe exchange`,
      },
      {
        id: "stock-avg-cost-audit",
        description: "Verify stock_balances vs immutable stock_movements ledger",
      },
      {
        id: "mysql-backup",
        description: "Run nightly mysqldump --single-transaction backup for MySQL 8 hkharp_pos",
      },
    ],
    legacySource: legacy,
  };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("index.ts")) {
  runWorkerCheck()
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
    })
    .catch((err) => {
      console.error("@hkharp/worker check failed:", err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    })
    .finally(() => {
      process.exit();
    });
}
