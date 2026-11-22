import fs from "node:fs";
import path from "node:path";

export function loadRootDotEnv(): Record<string, string> {
  const envPath = path.resolve(__dirname, "../../.env");
  const loaded: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return loaded;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    loaded[key] = val;
    if (
      !process.env[key] ||
      ((key === "DATABASE_URL" || key === "MIGRATE_DATABASE_URL") &&
        (process.env[key]?.includes("schooltracs") || process.env[key]?.includes(":3307")))
    ) {
      process.env[key] = val;
    }
  }
  return loaded;
}
