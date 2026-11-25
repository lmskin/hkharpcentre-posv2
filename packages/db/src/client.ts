import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "./schema/index";

const PLACEHOLDER_TOKENS = [
  "REPLACE_WITH_YOUR_MYSQL_PASSWORD",
  "change_me_in_prod",
  "change_me",
];

export function validateDatabaseUrl(rawUrl: string | undefined): URL {
  if (!rawUrl || rawUrl.trim() === "") {
    throw new Error(
      "DATABASE_URL is not set. Add DATABASE_URL to D:\\Projects\\hkharpcentre-pos-v2\\.env before running db:migrate.",
    );
  }
  for (const token of PLACEHOLDER_TOKENS) {
    if (rawUrl.includes(token)) {
      throw new Error(
        "DATABASE_URL in D:\\Projects\\hkharpcentre-pos-v2\\.env still contains a placeholder password. Replace it with your local MySQL 8 password and re-run.",
      );
    }
  }
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "mysql:") {
    throw new Error(`Unsupported DATABASE_URL protocol '${parsed.protocol}'; expected mysql://`);
  }
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!/^[A-Za-z0-9_]{1,64}$/.test(dbName)) {
    throw new Error(`Invalid MySQL database name '${dbName}' in DATABASE_URL`);
  }
  return parsed;
}

export function createDb(databaseUrl: string) {
  const pool = mysql.createPool({
    uri: databaseUrl,
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 5,
    idleTimeout: 30_000,
    connectTimeout: 15_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    decimalNumbers: false, // Preserve exact DECIMAL(18,4) strings
    timezone: "+08:00",
  });
  const db = drizzle(pool, { schema, mode: "default" });
  return { db, pool };
}

export type HarpDb = ReturnType<typeof createDb>["db"];
