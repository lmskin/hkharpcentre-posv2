import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { createDb, validateDatabaseUrl } from "./client";

async function ensureDatabaseExists(rawUrl: string, parsedUrl: URL, dbName: string) {
  try {
    const checkConn = await mysql.createConnection(rawUrl);
    try {
      await checkConn.query("SELECT 1");
      return;
    } finally {
      await checkConn.end();
    }
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
    if (code !== "ER_BAD_DB_ERROR") {
      throw err;
    }
  }

  const adminConn = await mysql.createConnection({
    host: parsedUrl.hostname,
    port: Number(parsedUrl.port || "3306"),
    user: decodeURIComponent(parsedUrl.username),
    password: decodeURIComponent(parsedUrl.password),
    timezone: "+08:00",
  });

  try {
    await adminConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci`,
    );
  } finally {
    await adminConn.end();
  }
}

async function main() {
  const rawUrl = process.env.DATABASE_URL;
  const parsedUrl = validateDatabaseUrl(rawUrl);
  const dbName = parsedUrl.pathname.replace(/^\//, "");

  await ensureDatabaseExists(rawUrl!, parsedUrl, dbName);

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(__dirname, "../drizzle");
  const { db, pool } = createDb(rawUrl!);

  try {
    await migrate(db, { migrationsFolder });
    const [tables] = await pool.query("SHOW TABLES");
    const tableCount = Array.isArray(tables) ? tables.length : 0;
    console.log(
      JSON.stringify(
        {
          ok: true,
          database: dbName,
          host: parsedUrl.hostname,
          port: Number(parsedUrl.port || "3306"),
          migrationsFolder,
          tableCount,
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
  console.error("MySQL migration failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
