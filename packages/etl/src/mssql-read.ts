import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface LegacyMssqlConfig {
  server: string;
  gsDatabase: string;
  gxDatabase: string;
}

export function getDefaultLegacyConfig(): LegacyMssqlConfig {
  return {
    server: process.env.LEGACY_MSSQL_SERVER ?? "localhost",
    gsDatabase: process.env.LEGACY_GS_DATABASE ?? "Scratch_DataGSHarpS1V47",
    gxDatabase: process.env.LEGACY_GX_DATABASE ?? "Scratch_DataGXHarpS1V47",
  };
}

/**
 * Runs a strictly read-only T-SQL query against localhost Scratch_Data*V47 databases via sqlcmd
 * using UTF-8 (-f 65001) and pipe-delimited output with zero headers. Never mutates SQL Server state.
 */
export async function querySqlcmdRows(
  server: string,
  tsql: string,
  timeoutMs = 30_000,
  database?: string,
): Promise<string[][]> {
  const args = ["-S", server];
  if (database) args.push("-d", database);
  args.push("-E", "-C", "-f", "65001", "-h", "-1", "-W", "-s", "|", "-Q", `SET NOCOUNT ON; ${tsql}`);

  const { stdout } = await execFileAsync("sqlcmd", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return stdout
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.split("|"));
}

/**
 * Runs a strictly read-only T-SQL query returning FOR JSON PATH, INCLUDE_NULL_VALUES
 * with unlimited output width (-y 0) and UTF-8 (-f 65001) so JSON rows are never truncated or corrupted.
 */
export async function querySqlcmdJson<T>(
  server: string,
  database: string,
  selectQueryWithoutForJson: string,
  timeoutMs = 60_000,
): Promise<T[]> {
  const cleanedSql = selectQueryWithoutForJson.trim().replace(/;+\s*$/, "");
  const fullSql = `SET NOCOUNT ON; ${cleanedSql} FOR JSON PATH, INCLUDE_NULL_VALUES;`;

  const { stdout } = await execFileAsync(
    "sqlcmd",
    ["-S", server, "-d", database, "-E", "-C", "-f", "65001", "-y", "0", "-Q", fullSql],
    { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: timeoutMs },
  );

  // IMPORTANT: sqlcmd splits FOR JSON output into ~2033-char lines. Never trimEnd() individual lines,
  // or a boundary landing on a space (e.g. inside "2017-03-04 15:47:38") would corrupt JSON strings.
  const jsonPayload = stdout.replace(/^\uFEFF/, "").replace(/\r?\n/g, "").trim();

  if (!jsonPayload) return [];
  return JSON.parse(jsonPayload) as T[];
}
