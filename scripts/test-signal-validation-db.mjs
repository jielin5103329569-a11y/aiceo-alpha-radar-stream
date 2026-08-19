import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const apiRequire = createRequire(resolve("artifacts/api-server/package.json"));
const dbRequire = createRequire(resolve("lib/db/package.json"));
const { build } = apiRequire("esbuild");
const esbuildPluginPino = apiRequire("esbuild-plugin-pino");
const { Client } = dbRequire("pg");

assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for the PostgreSQL integration test.");

const outputDirectory = mkdtempSync(join(tmpdir(), "signal-validation-db-bundle-"));
const migrationsFolder = join(outputDirectory, "db-migrations");
const outputPath = join(outputDirectory, "signal-validation-db-integration.mjs");
const hostReplacementOutputPath = join(outputDirectory, "signal-validation-host-replacement.mjs");
const schema = `signal_validation_test_${process.pid}_${Date.now()}`;
const adminClient = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await adminClient.connect();
  await adminClient.query(`CREATE SCHEMA "${schema}"`);

  cpSync(resolve("lib/db/drizzle"), migrationsFolder, { recursive: true });
  await build({
    entryPoints: [
      resolve("scripts/signal-validation-db-integration.ts"),
      resolve("scripts/signal-validation-host-replacement.ts"),
    ],
    outdir: outputDirectory,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    nodePaths: [
      resolve("artifacts/api-server/node_modules"),
      resolve("lib/db/node_modules"),
    ],
    sourcemap: "inline",
    external: ["pg-native"],
    plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
    banner: {
      js: `import { createRequire as __integrationCreateRequire } from "node:module";
globalThis.require = __integrationCreateRequire(import.meta.url);`,
    },
    logLevel: "silent",
  });
  const databaseUrl = new URL(process.env.DATABASE_URL);
  const existingOptions = databaseUrl.searchParams.get("options");
  databaseUrl.searchParams.set(
    "options",
    [existingOptions, `-csearch_path=${schema}`].filter(Boolean).join(" "),
  );
  const baseEnvironment = {
    ...process.env,
    DATABASE_URL: databaseUrl.toString(),
    LOG_LEVEL: "silent",
    NODE_ENV: "production",
    SIGNAL_VALIDATION_MIGRATIONS_PATH: migrationsFolder,
    SIGNAL_VALIDATION_MIGRATIONS_SCHEMA: schema,
  };
  const run = (entryPoint, extraEnvironment = {}) => {
    const result = spawnSync(process.execPath, [entryPoint], {
      cwd: process.cwd(),
      env: { ...baseEnvironment, ...extraEnvironment },
      encoding: "utf8",
      timeout: 30_000,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    assert.equal(result.status, 0, `Integration process exited with ${result.status}.`);
  };
  run(outputPath);

  const hostArchiveDirectory = mkdtempSync(join(tmpdir(), "signal-validation-host-archive-"));
  const hostOutboxDirectory = mkdtempSync(join(tmpdir(), "signal-validation-host-outbox-"));
  const hostSuffix = `${process.pid}-${Date.now()}`;
  try {
    mkdirSync(join(hostOutboxDirectory, "unavailable-primary"));
    mkdirSync(join(hostOutboxDirectory, "unavailable-fallback"));
    run(hostReplacementOutputPath, {
      SIGNAL_VALIDATION_HOST_ROLE: "capture",
      SIGNAL_VALIDATION_HOST_ARCHIVE_DIR: hostArchiveDirectory,
      SIGNAL_VALIDATION_HOST_OUTBOX_DIR: hostOutboxDirectory,
      SIGNAL_VALIDATION_HOST_SUFFIX: hostSuffix,
    });
    rmSync(hostOutboxDirectory, { recursive: true, force: true });
    mkdirSync(hostOutboxDirectory);
    const recoveryEnvironment = {
      SIGNAL_VALIDATION_HOST_ROLE: "recover",
      SIGNAL_VALIDATION_HOST_ARCHIVE_DIR: hostArchiveDirectory,
      SIGNAL_VALIDATION_HOST_OUTBOX_DIR: hostOutboxDirectory,
      SIGNAL_VALIDATION_HOST_SUFFIX: hostSuffix,
    };
    run(hostReplacementOutputPath, {
      ...recoveryEnvironment,
      SIGNAL_VALIDATION_HOST_ROLE: "conflict",
    });
    run(hostReplacementOutputPath, {
      ...recoveryEnvironment,
      SIGNAL_VALIDATION_HOST_ROLE: "plant-legacy-conflict",
    });
    run(hostReplacementOutputPath, recoveryEnvironment);
    run(hostReplacementOutputPath, recoveryEnvironment);
  } finally {
    rmSync(hostArchiveDirectory, { recursive: true, force: true });
    rmSync(hostOutboxDirectory, { recursive: true, force: true });
  }
} finally {
  if (adminClient._connected) {
    await adminClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminClient.end();
  }
  rmSync(outputDirectory, { recursive: true, force: true });
}