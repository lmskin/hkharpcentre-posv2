import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { createDb, validateDatabaseUrl } from "./client";

async function main() {
  const parsedUrl = validateDatabaseUrl(process.env.DATABASE_URL);
  const dbName = parsedUrl.pathname.replace(/^\//, "");

  // Ensure target schema exists with MySQL 8 utf8mb4_0900_as_ci before applying migrations
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

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(__dirname, "../drizzle");
  const { db, pool } = createDb(process.env.DATABASE_URL!);

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
