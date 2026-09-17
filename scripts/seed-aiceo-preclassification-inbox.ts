import assert from "node:assert/strict";
import { count, eq } from "drizzle-orm";
import {
  aiceoContinuityProjectsTable, aiceoContinuityStateTable, aiceoMemoryCandidatesTable,
  aiceoMemoryEventsTable, aiceoPreclassificationMemoryInboxTable, aiceoPromotedMemoriesTable,
  aiceoThoughtNodesTable, db, pool,
} from "@workspace/db";
import { aiceoPreclassificationInbox } from "../artifacts/api-server/src/lib/aiceoPreclassificationInbox";
import {
  PRECLASSIFICATION_HIGH_VALUE_THEMES, PRECLASSIFICATION_OBSERVED_AT, PRECLASSIFICATION_SEED_BATCH,
} from "../artifacts/api-server/src/lib/aiceoPreclassificationManifest";

async function main() {
  const records = await db.transaction(async (tx) => {
    const [project] = await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).for("update");
    const [state] = project ? await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update") : [];
    assert.ok(project && state);
    assert.equal(state.revision, 37);
    assert.equal(state.currentState.verification, "NOT_VERIFIED");
    const before = {
      candidates: Number((await tx.select({ value: count() }).from(aiceoMemoryCandidatesTable))[0].value),
      promoted: Number((await tx.select({ value: count() }).from(aiceoPromotedMemoriesTable))[0].value),
      events: Number((await tx.select({ value: count() }).from(aiceoMemoryEventsTable))[0].value),
      thoughts: Number((await tx.select({ value: count() }).from(aiceoThoughtNodesTable))[0].value),
    };
    const inserted = [];
    for (const theme of PRECLASSIFICATION_HIGH_VALUE_THEMES) {
      inserted.push(await aiceoPreclassificationInbox.append({
        projectId: project.id, seedBatchKey: PRECLASSIFICATION_SEED_BATCH,
        stableKey: theme.stableKey, rawSemantics: theme.rawSemantics,
        sourceContext: theme.sourceContext, observedAt: PRECLASSIFICATION_OBSERVED_AT,
        futureClassificationHints: [...theme.futureClassificationHints], transaction: tx,
      }));
    }
    assert.deepEqual(inserted.map((record) => Number(record.appendSequence)), [1,2,3,4,5,6,7,8]);
    assert.equal(new Set(inserted.map((record) => record.recordHash)).size, 8);
    const after = {
      candidates: Number((await tx.select({ value: count() }).from(aiceoMemoryCandidatesTable))[0].value),
      promoted: Number((await tx.select({ value: count() }).from(aiceoPromotedMemoriesTable))[0].value),
      events: Number((await tx.select({ value: count() }).from(aiceoMemoryEventsTable))[0].value),
      thoughts: Number((await tx.select({ value: count() }).from(aiceoThoughtNodesTable))[0].value),
    };
    assert.deepEqual(after, before);
    return inserted;
  });
  assert.equal((await db.select().from(aiceoPreclassificationMemoryInboxTable)).length, 8);
  console.log(JSON.stringify({ saved: records.length, lifecycle: "awaiting_scientific_classification", productionAuthority: false }));
  await pool.end();
}
main().catch((error) => { console.error(error); process.exitCode = 1; });