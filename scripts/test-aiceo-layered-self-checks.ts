import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aiceoContinuityProjectsTable, aiceoSelfCheckReportsTable, db, pool,
  aiceoSelfCheckChainContractsTable,
} from "@workspace/db";
import { aiceoSelfChecks } from "../artifacts/api-server/src/lib/aiceoSelfChecks";

const dimensions = (status: "healthy" | "degraded" = "healthy") => ({
  input: status, output: "healthy" as const, state: "healthy" as const,
  permission: "healthy" as const, evidence: "healthy" as const,
  version: "healthy" as const, freshness: "healthy" as const, invariant: "healthy" as const,
});
const evidence = () => [{
  sourceType: "system_record", sourceId: randomUUID(), evidenceHash: "a".repeat(64),
}];
const text = (error: unknown): string => {
  if (!error || typeof error !== "object") return String(error);
  const value = error as { message?: string; cause?: unknown };
  return `${value.message ?? ""} ${value.cause ? text(value.cause) : ""}`;
};
const rejects = async (expected: RegExp, work: () => Promise<unknown>) => {
  try { await work(); assert.fail("unexpected success"); }
  catch (error) { assert.match(text(error), expected); }
};

async function seed(tx: any, projectId: string, localStatus: "healthy" | "degraded" = "healthy") {
  const runId = randomUUID();
  const checkedAt = new Date(Date.now() - 1000);
  const validUntil = new Date(Date.now() + 300_000);
  const locals = [];
  for (const [index, moduleKey] of ["memory-candidate", "memory-event", "thought-node"].entries()) {
    const status = index === 0 ? localStatus : "healthy";
    locals.push(await aiceoSelfChecks.createReport({
      projectId, runId, scope: "local", chainKey: "g1-memory", moduleKey,
      status, checkedAt, validUntil, dimensions: dimensions(status),
      summary: { contract: moduleKey },
      anomalies: status === "healthy" ? [] : ["input_degraded"],
      evidenceLineage: evidence(), escalation: status === "healthy" ? "none" : "chain",
      transaction: tx,
    }));
  }
  return { runId, checkedAt, validUntil, locals };
}
const aggregateEvidence = (reports: any[]) => reports.map((report) => ({
  sourceType: "self_check_report", sourceId: report.id, evidenceHash: report.reportHash,
}));

async function main() {
  const [project] = await db.select().from(aiceoContinuityProjectsTable)
    .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).limit(1);
  assert.ok(project);
  const before = await db.select().from(aiceoSelfCheckReportsTable);

  await rejects(/intentional rollback/, () => db.transaction(async (tx) => {
    const seeded = await seed(tx, project.id);
    const chain = await aiceoSelfChecks.createReport({
      projectId: project.id, runId: seeded.runId, scope: "chain", chainKey: "g1-memory",
      status: "healthy", checkedAt: seeded.checkedAt, validUntil: seeded.validUntil,
      summary: { localReports: 3 }, evidenceLineage: aggregateEvidence(seeded.locals),
      childReportIds: seeded.locals.map((report) => report.id), escalation: "none", transaction: tx,
    });
    const global = await aiceoSelfChecks.createReport({
      projectId: project.id, runId: seeded.runId, scope: "global", chainKey: "global",
      status: "healthy", checkedAt: seeded.checkedAt, validUntil: seeded.validUntil,
      summary: { chainReports: 1 }, evidenceLineage: aggregateEvidence([chain]),
      childReportIds: [chain.id], escalation: "none", transaction: tx,
    });
    const reports = await aiceoSelfChecks.latestHealthSummary(project.id, tx);
    assert.equal(reports.length, before.length + 5);
    assert.deepEqual([...seeded.locals.map((report) => report.appendSequence), chain.appendSequence, global.appendSequence], [
      seeded.locals[0].appendSequence, seeded.locals[0].appendSequence + 1,
      seeded.locals[0].appendSequence + 2, seeded.locals[0].appendSequence + 3,
      seeded.locals[0].appendSequence + 4,
    ]);
    assert.equal(chain.previousHash, seeded.locals[2].reportHash);
    assert.equal(global.previousHash, chain.reportHash);
    assert.ok(reports.every((report: any) => !("evidenceLineage" in report)));
    throw new Error("intentional rollback");
  }));

  await rejects(/cannot be healthier/, () => db.transaction(async (tx) => {
    const seeded = await seed(tx, project.id, "degraded");
    await aiceoSelfChecks.createReport({
      projectId: project.id, runId: seeded.runId, scope: "chain", chainKey: "g1-memory",
      status: "healthy", checkedAt: seeded.checkedAt, validUntil: seeded.validUntil,
      summary: {}, evidenceLineage: aggregateEvidence(seeded.locals),
      childReportIds: seeded.locals.map((report) => report.id),
      escalation: "none", transaction: tx,
    });
  }));
  await rejects(/global summary cannot scan raw payloads/, () => db.transaction(async (tx) => {
    const seeded = await seed(tx, project.id);
    const chain = await aiceoSelfChecks.createReport({
      projectId: project.id, runId: seeded.runId, scope: "chain", chainKey: "g1-memory",
      status: "healthy", checkedAt: seeded.checkedAt, validUntil: seeded.validUntil,
      summary: {}, evidenceLineage: aggregateEvidence(seeded.locals),
      childReportIds: seeded.locals.map((report) => report.id),
      escalation: "none", transaction: tx,
    });
    await aiceoSelfChecks.createReport({
      projectId: project.id, runId: seeded.runId, scope: "global", chainKey: "global",
      status: "healthy", checkedAt: seeded.checkedAt, validUntil: seeded.validUntil,
      summary: {}, evidenceLineage: aggregateEvidence([chain]), childReportIds: [chain.id],
      escalation: "none", rawPayloadIncluded: true, transaction: tx,
    });
  }));
  await rejects(/append-only diagnostics/, () => db.transaction(async (tx) => {
    const seeded = await seed(tx, project.id);
    await tx.update(aiceoSelfCheckReportsTable).set({ summary: { tampered: true } })
      .where(eq(aiceoSelfCheckReportsTable.id, seeded.locals[0].id));
  }));
  await rejects(/independent_validation|check constraint/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoSelfCheckReportsTable).values({
      projectId: project.id, runId: randomUUID(), scope: "local", chainKey: "x", moduleKey: "x",
      contractVersion: "G1-001-SC-1", status: "healthy", checkedAt: new Date(Date.now()-1000),
      validUntil: new Date(Date.now()+60_000), dimensions: dimensions(), summary: {},
      anomalies: [], evidenceLineage: evidence(), childReportIds: [], faultDomains: [],
      escalation: "none", diagnosticDepth: "summary", rawPayloadIncluded: false,
      appendSequence: 0, reportHash: "db-owned", independentValidation: true,
      closureAuthority: false, productionAuthority: false,
    });
  }));
  await rejects(/dimensions are incomplete or invalid/, () => db.transaction(async (tx) => {
    await aiceoSelfChecks.createReport({
      projectId: project.id, runId: randomUUID(), scope: "local",
      chainKey: "g1-memory", moduleKey: "thought-node", status: "healthy",
      checkedAt: new Date(Date.now()-1000), validUntil: new Date(Date.now()+60_000),
      dimensions: { ...dimensions(), extra: "healthy" }, summary: {},
      evidenceLineage: evidence(), escalation: "none", transaction: tx,
    });
  }));
  await rejects(/children are incomplete/, () => db.transaction(async (tx) => {
    const seeded = await seed(tx, project.id);
    await aiceoSelfChecks.createReport({
      projectId: project.id, runId: seeded.runId, scope: "chain", chainKey: "g1-memory",
      status: "healthy", checkedAt: seeded.checkedAt, validUntil: seeded.validUntil,
      summary: {}, evidenceLineage: aggregateEvidence(seeded.locals.slice(0, 2)),
      childReportIds: seeded.locals.slice(0, 2).map((report) => report.id),
      escalation: "none", transaction: tx,
    });
  }));
  await rejects(/children are incomplete, stale, or cross-boundary/, () => db.transaction(async (tx) => {
    const seeded = await seed(tx, project.id);
    await aiceoSelfChecks.createReport({
      projectId: project.id, runId: seeded.runId, scope: "chain", chainKey: "g1-memory",
      status: "healthy", checkedAt: new Date(seeded.checkedAt.getTime()-5000),
      validUntil: seeded.validUntil, summary: {},
      evidenceLineage: aggregateEvidence(seeded.locals),
      childReportIds: seeded.locals.map((report) => report.id),
      escalation: "none", transaction: tx,
    });
  }));
  await rejects(/not bound to child report hashes/, () => db.transaction(async (tx) => {
    const seeded = await seed(tx, project.id);
    const forged = aggregateEvidence(seeded.locals);
    forged[0].evidenceHash = "b".repeat(64);
    await aiceoSelfChecks.createReport({
      projectId: project.id, runId: seeded.runId, scope: "chain", chainKey: "g1-memory",
      status: "healthy", checkedAt: seeded.checkedAt, validUntil: seeded.validUntil,
      summary: {}, evidenceLineage: forged,
      childReportIds: seeded.locals.map((report) => report.id),
      escalation: "none", transaction: tx,
    });
  }));
  await rejects(/healthy self-check cannot carry anomalies/, () => db.transaction(async (tx) => {
    await aiceoSelfChecks.createReport({
      projectId: project.id, runId: randomUUID(), scope: "local",
      chainKey: "g1-memory", moduleKey: "thought-node", status: "healthy",
      checkedAt: new Date(Date.now()-1000), validUntil: new Date(Date.now()+60_000),
      dimensions: dimensions(), summary: {}, anomalies: ["fabricated_warning"],
      evidenceLineage: evidence(), escalation: "none", transaction: tx,
    });
  }));
  await rejects(/valid fault-domain localization/, () => db.transaction(async (tx) => {
    const seeded = await seed(tx, project.id, "degraded");
    await aiceoSelfChecks.createReport({
      projectId: project.id, runId: seeded.runId, scope: "chain", chainKey: "g1-memory",
      status: "degraded", checkedAt: seeded.checkedAt, validUntil: seeded.validUntil,
      summary: {}, anomalies: ["input_degraded"], faultDomains: ["not-a-module"],
      evidenceLineage: aggregateEvidence(seeded.locals),
      childReportIds: seeded.locals.map((report) => report.id),
      escalation: "global", transaction: tx,
    });
  }));
  await rejects(/intentional deep rollback/, () => db.transaction(async (tx) => {
    const seeded = await seed(tx, project.id, "degraded");
    const chain = await aiceoSelfChecks.createReport({
      projectId: project.id, runId: seeded.runId, scope: "chain", chainKey: "g1-memory",
      status: "degraded", checkedAt: seeded.checkedAt, validUntil: seeded.validUntil,
      summary: {}, anomalies: ["input_degraded"], faultDomains: ["memory-candidate"],
      evidenceLineage: aggregateEvidence(seeded.locals),
      childReportIds: seeded.locals.map((report) => report.id),
      escalation: "global", transaction: tx,
    });
    const global = await aiceoSelfChecks.createReport({
      projectId: project.id, runId: seeded.runId, scope: "global", chainKey: "global",
      status: "degraded", checkedAt: seeded.checkedAt, validUntil: seeded.validUntil,
      summary: { expandedOnlyBecause: "chain_unexplained" },
      anomalies: ["chain_unexplained"], faultDomains: ["g1-memory"],
      evidenceLineage: aggregateEvidence([chain]), childReportIds: [chain.id],
      escalation: "global", diagnosticDepth: "deep", rawPayloadIncluded: true,
      escalationReason: "Chain summary cannot explain the observed inconsistency.",
      transaction: tx,
    });
    assert.equal(global.diagnosticDepth, "deep");
    throw new Error("intentional deep rollback");
  }));
  await rejects(/deep check requires unexplained chain or cross-chain conflict/, () => db.transaction(async (tx) => {
    const seeded = await seed(tx, project.id, "degraded");
    const chain = await aiceoSelfChecks.createReport({
      projectId: project.id, runId: seeded.runId, scope: "chain", chainKey: "g1-memory",
      status: "degraded", checkedAt: seeded.checkedAt, validUntil: seeded.validUntil,
      summary: {}, anomalies: ["input_degraded"], faultDomains: ["memory-candidate"],
      evidenceLineage: aggregateEvidence(seeded.locals),
      childReportIds: seeded.locals.map((report) => report.id),
      escalation: "global", transaction: tx,
    });
    await aiceoSelfChecks.createReport({
      projectId: project.id, runId: seeded.runId, scope: "global", chainKey: "global",
      status: "degraded", checkedAt: seeded.checkedAt, validUntil: seeded.validUntil,
      summary: {}, anomalies: ["ordinary_warning"], faultDomains: ["g1-memory"],
      evidenceLineage: aggregateEvidence([chain]), childReportIds: [chain.id],
      escalation: "global", diagnosticDepth: "deep", rawPayloadIncluded: true,
      escalationReason: "not a permitted trigger", transaction: tx,
    });
  }));
  await rejects(/migration-owned and immutable/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoSelfCheckChainContractsTable).values({
      chainKey: "forged-chain", contractVersion: "G1-001-SC-1",
      requiredModuleKeys: ["forged-module"], active: true, productionAuthority: false,
    });
  }));
  assert.equal((await db.select().from(aiceoSelfCheckReportsTable)).length, before.length);
  await pool.end();
  console.log("AICEO G1-001 layered self-checks: PASS (local→chain→global, escalation gates, zero residue)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });