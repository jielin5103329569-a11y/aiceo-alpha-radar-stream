import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { aiceoContinuityProjectsTable, aiceoControlStateTable, aiceoMemoryCandidatesTable, aiceoMemoryEventsTable, aiceoPreclassificationMemoryInboxTable, aiceoPreclassificationSeedManifestTable, aiceoThoughtNodesTable, db, pool } from "@workspace/db";
import { aiceoPreclassificationInbox } from "../artifacts/api-server/src/lib/aiceoPreclassificationInbox";
import { PRECLASSIFICATION_HIGH_VALUE_THEMES, PRECLASSIFICATION_OBSERVED_AT, PRECLASSIFICATION_SEED_BATCH } from "../artifacts/api-server/src/lib/aiceoPreclassificationManifest";
const errorText = (error: unknown): string => error instanceof Error ? `${error.message} ${error.cause ? errorText(error.cause) : ""}` : String(error);
const rejects = async (pattern: RegExp, work: () => Promise<unknown>) => {
  try { await work(); assert.fail("unexpected success"); } catch (error) { assert.match(errorText(error), pattern); }
};
async function main() {
  const [project] = await db.select().from(aiceoContinuityProjectsTable)
    .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).limit(1);
  assert.ok(project);
  const baseline = await aiceoPreclassificationInbox.inspect(project.id);
  const protectedBefore = {
    candidates: (await db.select().from(aiceoMemoryCandidatesTable)).length,
    events: (await db.select().from(aiceoMemoryEventsTable)).length,
    thoughts: (await db.select().from(aiceoThoughtNodesTable)).length,
  };
  assert.deepEqual(await aiceoPreclassificationInbox.verifyIntegrity(project.id), { count: 8, valid: true });
  const manifest = await db.select().from(aiceoPreclassificationSeedManifestTable);
  assert.equal(manifest.length, 8);
  assert.equal(baseline.length, 8);
  assert.deepEqual(baseline.map((row) => row.stableKey), PRECLASSIFICATION_HIGH_VALUE_THEMES.map((theme) => theme.stableKey));
  assert.deepEqual(baseline.map((row) => Number(row.appendSequence)), [1,2,3,4,5,6,7,8]);
  for (const [index, row] of baseline.entries()) {
    assert.equal(row.rawSemantics, PRECLASSIFICATION_HIGH_VALUE_THEMES[index].rawSemantics);
    assert.match(row.sourceDigest, /^[a-f0-9]{64}$/); assert.match(row.recordHash, /^[a-f0-9]{64}$/);
    assert.equal(row.previousHash, index ? baseline[index-1].recordHash : null);
    assert.equal(row.lifecycle, "awaiting_scientific_classification");
    assert.equal(row.epistemicState, "pre_classification_unverified");
    assert.equal(row.operationalInput || row.retrievalAuthority || row.promotionAuthority || row.governanceAuthority || row.productionAuthority, false);
  }
  const replay = await aiceoPreclassificationInbox.append({
    projectId: project.id, seedBatchKey: PRECLASSIFICATION_SEED_BATCH,
    stableKey: PRECLASSIFICATION_HIGH_VALUE_THEMES[0].stableKey,
    rawSemantics: PRECLASSIFICATION_HIGH_VALUE_THEMES[0].rawSemantics,
    sourceContext: PRECLASSIFICATION_HIGH_VALUE_THEMES[0].sourceContext,
    observedAt: PRECLASSIFICATION_OBSERVED_AT,
    futureClassificationHints: [...PRECLASSIFICATION_HIGH_VALUE_THEMES[0].futureClassificationHints],
  });
  assert.equal(replay.id, baseline[0].id);
  const concurrent = await Promise.all(Array.from({ length: 6 }, () => aiceoPreclassificationInbox.append({
    projectId: project.id, seedBatchKey: PRECLASSIFICATION_SEED_BATCH,
    stableKey: PRECLASSIFICATION_HIGH_VALUE_THEMES[1].stableKey,
    rawSemantics: PRECLASSIFICATION_HIGH_VALUE_THEMES[1].rawSemantics,
    sourceContext: PRECLASSIFICATION_HIGH_VALUE_THEMES[1].sourceContext,
    observedAt: PRECLASSIFICATION_OBSERVED_AT,
    futureClassificationHints: [...PRECLASSIFICATION_HIGH_VALUE_THEMES[1].futureClassificationHints],
  })));
  assert.equal(new Set(concurrent.map((record) => record.id)).size, 1);
  await rejects(/conflicts with immutable original semantics/, () => aiceoPreclassificationInbox.append({
    projectId: project.id, seedBatchKey: PRECLASSIFICATION_SEED_BATCH,
    stableKey: baseline[0].stableKey, rawSemantics: "changed meaning",
    sourceContext: PRECLASSIFICATION_HIGH_VALUE_THEMES[0].sourceContext,
    observedAt: PRECLASSIFICATION_OBSERVED_AT,
    futureClassificationHints: ["knowledge_memory"],
  }));
  await rejects(/immutable provenance roots/, () => db.update(aiceoPreclassificationMemoryInboxTable)
    .set({ rawSemantics: "rewritten" }).where(eq(aiceoPreclassificationMemoryInboxTable.id, baseline[0].id)));
  await rejects(/immutable provenance roots/, () => db.delete(aiceoPreclassificationMemoryInboxTable)
    .where(eq(aiceoPreclassificationMemoryInboxTable.id, baseline[0].id)));
  await rejects(/scientific destination whitelist/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoPreclassificationMemoryInboxTable).values({
      ...baseline[0], id: undefined, stableKey: baseline[0].stableKey,
      futureClassificationHints: ["governance_rule" as any],
      appendSequence: 0, sourceDigest: "db-owned", recordHash: "db-owned", migrationContractHash: "db-owned",
      createdAt: undefined,
    });
  }));
  await rejects(/source context or time is invalid/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoPreclassificationMemoryInboxTable).values({
      ...baseline[0], id: undefined, sourceContext: { context: "missing deferred marker" },
      appendSequence: 0, sourceDigest: "db-owned", recordHash: "db-owned", migrationContractHash: "db-owned",
      createdAt: undefined,
    });
  }));
  await rejects(/Queue, Kill Switch, or Circuit Breaker/, () => db.transaction(async (tx) => {
    await tx.update(aiceoControlStateTable).set({ killSwitch: true });
    await aiceoPreclassificationInbox.append({
      projectId: project.id, seedBatchKey: PRECLASSIFICATION_SEED_BATCH,
      stableKey: PRECLASSIFICATION_HIGH_VALUE_THEMES[0].stableKey,
      rawSemantics: PRECLASSIFICATION_HIGH_VALUE_THEMES[0].rawSemantics,
      sourceContext: PRECLASSIFICATION_HIGH_VALUE_THEMES[0].sourceContext,
      observedAt: PRECLASSIFICATION_OBSERVED_AT,
      futureClassificationHints: [...PRECLASSIFICATION_HIGH_VALUE_THEMES[0].futureClassificationHints],
      transaction: tx,
    });
  }));
  await rejects(/migration-owned and immutable/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoPreclassificationSeedManifestTable).values({
      seedBatchKey: "forged", stableKey: "ninth-theme",
      rawSemanticsDigest: "a".repeat(64), productionAuthority: false,
    });
  }));
  await rejects(/project boundary violation/, () => aiceoPreclassificationInbox.append({
    projectId: "00000000-0000-4000-8000-000000000001",
    seedBatchKey: PRECLASSIFICATION_SEED_BATCH,
    stableKey: PRECLASSIFICATION_HIGH_VALUE_THEMES[0].stableKey,
    rawSemantics: PRECLASSIFICATION_HIGH_VALUE_THEMES[0].rawSemantics,
    sourceContext: PRECLASSIFICATION_HIGH_VALUE_THEMES[0].sourceContext,
    observedAt: PRECLASSIFICATION_OBSERVED_AT,
    futureClassificationHints: [...PRECLASSIFICATION_HIGH_VALUE_THEMES[0].futureClassificationHints],
  }));
  for (const controlPatch of [{ queueActive: false }, { circuitState: "OPEN" as const }]) {
    await rejects(/Queue, Kill Switch, or Circuit Breaker/, () => db.transaction(async (tx) => {
      await tx.update(aiceoControlStateTable).set(controlPatch);
      await aiceoPreclassificationInbox.append({
        projectId: project.id, seedBatchKey: PRECLASSIFICATION_SEED_BATCH,
        stableKey: baseline[0].stableKey, rawSemantics: baseline[0].rawSemantics,
        sourceContext: baseline[0].sourceContext, observedAt: baseline[0].observedAt,
        futureClassificationHints: baseline[0].futureClassificationHints, transaction: tx,
      });
    }));
  }
  await rejects(/unique constraint|duplicate key/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoPreclassificationMemoryInboxTable).values({
      ...baseline[0], id: undefined,
      sourceContext: { ...baseline[0].sourceContext, context: "altered but otherwise valid context" },
      appendSequence: 0, sourceDigest: "db-owned", recordHash: "db-owned", migrationContractHash: "db-owned",
      createdAt: undefined,
    });
  }));
  await rejects(/migration must preserve origin provenance/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoPreclassificationMemoryInboxTable).values({
      ...baseline[0], id: undefined, migrationRequirements: { scientificClassificationRequired: true },
      appendSequence: 0, sourceDigest: "db-owned", recordHash: "db-owned", migrationContractHash: "db-owned",
      createdAt: undefined,
    });
  }));
  await rejects(/check constraint|no operational or governance authority/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoPreclassificationMemoryInboxTable).values({
      ...baseline[0], id: undefined, productionAuthority: true,
      appendSequence: 0, sourceDigest: "db-owned", recordHash: "db-owned", migrationContractHash: "db-owned",
      createdAt: undefined,
    });
  }));
  const publicPrivileges = await db.execute(sql`
    SELECT has_table_privilege('public','aiceo_preclassification_memory_inbox','SELECT,INSERT,UPDATE,DELETE') allowed
  `);
  assert.equal((publicPrivileges.rows[0] as any).allowed, false);
  assert.equal((await aiceoPreclassificationInbox.inspect(project.id)).length, 8);
  assert.deepEqual({
    candidates: (await db.select().from(aiceoMemoryCandidatesTable)).length,
    events: (await db.select().from(aiceoMemoryEventsTable)).length,
    thoughts: (await db.select().from(aiceoThoughtNodesTable)).length,
  }, protectedBefore);
  await pool.end();
  console.log("AICEO G1-001 pre-classification inbox: PASS (8 immutable themes, idempotent replay, no authority)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });