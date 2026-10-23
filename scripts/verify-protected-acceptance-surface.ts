import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Trusted baseline from pre-change commit f3b1989a6ab7706ef4babe7105902c10998312a0.
 * Executor cannot approve its own replacement baseline.
 * Changes to these files require independent validator attestation (not implemented here as runtime; policy enforces via review).
 */
const PROTECTED_ACCEPTANCE_SURFACE: Record<string, string> = {
  "artifacts/api-server/src/lib/aiceoContinuityLayer.ts": "ec14e5b8efffcfe82d676bc71cc9646de12f6ee9",
  "scripts/audit-aiceo-g1-001-closure.ts": "0dae2bc3e11892d3c5c099c113fc13590f5765eb",
  "scripts/test-aiceo-continuity-layer.mjs": "08a49bd5f37e2c257435e90c35e1367f5784fb2f",
  "package.json": "8e468c4c4ed14b85241f7caa3740fe5b6ae7d43e",
  "MEMORY_V1/LOG/TASKS.md": "d2f88ef5ea20b1870b8585636f08b9044573c013",
};

function gitBlobSha(content: string): string {
  const header = `blob ${Buffer.byteLength(content)}\0`;
  return createHash("sha1").update(header + content).digest("hex");
}

function main() {
  const repoRoot = process.cwd();
  const mismatches: string[] = [];
  for (const [relPath, expectedSha] of Object.entries(PROTECTED_ACCEPTANCE_SURFACE)) {
    const full = path.join(repoRoot, relPath);
    if (!fs.existsSync(full)) {
      mismatches.push(`${relPath}: MISSING`);
      continue;
    }
    const content = fs.readFileSync(full, "utf8");
    const actual = gitBlobSha(content);
    if (actual !== expectedSha) {
      mismatches.push(`${relPath}: expected ${expectedSha} got ${actual}`);
    }
  }
  if (mismatches.length > 0) {
    console.error("Fail-Closed: protected acceptance surface tampered or drifted from trusted baseline f3b1989a6ab7706ef4babe7105902c10998312a0");
    console.error(mismatches.join("\n"));
    console.error("Executor cannot unilaterally weaken monitoring, approval, or acceptance tests. Independent validator + Owner authority required for protected surface changes.");
    process.exit(1);
  }
  console.log("PROTECTED_ACCEPTANCE_SURFACE: VERIFIED against baseline f3b1989a6ab7706ef4babe7105902c10998312a0");
  console.log("Tamper attempts (delete/skip/invert/impersonate) would be rejected by this gate.");
  console.log("Normal authorized changes outside this surface remain allowed via existing chain.");
}

main();
