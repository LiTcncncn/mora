import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), ".env.local");
if (!fs.existsSync(file)) process.exit(0);
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const separator = trimmed.indexOf("=");
  if (separator < 1) continue;
  const key = trimmed.slice(0, separator);
  if (process.env[key] !== undefined) continue;
  let value = trimmed.slice(separator + 1);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  process.env[key] = value;
}
