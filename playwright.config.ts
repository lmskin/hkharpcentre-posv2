import { defineConfig } from "@playwright/test";
import { loadRootDotEnv } from "./e2e/helpers/env";

const dotEnv = loadRootDotEnv();

const webServerEnv: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  ),
  ...dotEnv,
  DATABASE_URL: dotEnv.DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  MIGRATE_DATABASE_URL: dotEnv.MIGRATE_DATABASE_URL ?? dotEnv.DATABASE_URL ?? "",
  HARDWARE_BRIDGE_URL: "http://127.0.0.1:17889",
  HARDWARE_BRIDGE_TOKEN: "e2e-bridge-token",
  PORT: "3100",
};

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: "chrome",
    headless: true,
    viewport: { width: 1366, height: 860 },
    acceptDownloads: true,
  },
  webServer: [
    {
      command: "node ./node_modules/tsx/dist/cli.mjs e2e/helpers/mock-bridge.ts",
      url: "http://127.0.0.1:17889/health",
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        PORT: "17889",
        HARDWARE_BRIDGE_TOKEN: "e2e-bridge-token",
      },
    },
    {
      command: "node ./node_modules/next/dist/bin/next start apps/web -p 3100",
      url: "http://127.0.0.1:3100/api/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: webServerEnv,
    },
  ],
});
