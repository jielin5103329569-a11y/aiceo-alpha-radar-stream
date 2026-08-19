import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const schemaPath = fileURLToPath(
  new URL("../api-client-react/src/generated/api.schemas.ts", import.meta.url),
);
const source = readFileSync(schemaPath, "utf8");
const normalized = `${source.replace(/\s+$/u, "")}\n`;

if (normalized !== source) {
  writeFileSync(schemaPath, normalized, "utf8");
}