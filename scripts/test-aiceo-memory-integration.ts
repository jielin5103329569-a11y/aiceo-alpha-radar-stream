import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import {
  aiceoContinuityProjectsTable, aiceoControlStateTable, aiceoMemoryCandidatesTable,
  aiceoMemoryEventsTable, aiceoPromotedMemoriesTable, db, pool,
} from "@workspace/db";
import { aiceoMemory, assertEvidenceValid } from "../artifacts/api-server/src/lib/aiceoMemory";

const errorText = (error: unknown): string => {
  if (!error || typeof error !== "object") return String(error);
  const value = error as { message?: string; cause?: unknown };
  return `${value.message ?? ""} ${value.cause ? errorText(value.cause) : ""}`;
};
const rejected = async (name: string, expected: RegExp, work: () => Promise<unknown>) => {
  try {
    await work();
    assert.fail(`${name} unexpectedly succeeded`);
  } catch (error) {
    const text = errorText(error);
    assert.match(text, expected, `${name} failed for the wrong reason: ${text}`);
  }
};
const rollback = async (work: (tx: any) => Promise<void>) => {
  await rejected("intentional rollback", /G1-001 intentional rollback/, () =>
    db.transaction(async (tx) => {
      await work(tx);
      throw new Error("G1-001 intentional rollback");
    }));
};

async function main() {
  const [project] = await db.select().from(aiceoContinuityProjectsTable)
    .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).limit(1);
  assert.ok(project, "canonical AICEO project is required");
  const marker = `g1-001-${randomUUID()}`;
  const evidence = [{
    sourceType: "conversation_turn",
    sourceId: marker,
    evidenceHash: "a".repeat(64),
    observedAt: new Date(Date.now() - 1000).toISOString(),
  }];
  const values = {
    projectId: project.id, content: marker, memoryLayer: "semantic", memoryType: "observation",
    cognitiveState: "observation", truthLevel: "unverified", authorityLevel: "ordinary_agent" as const,
    sourceActorId: "integration-test", evidenceLineage: evidence,
  };
  const rolledBackIds: string[] = [];

  await rollback(async (tx) => {
    const first = await aiceoMemory.createCandidate({ ...values, transaction: tx });
    const second = await aiceoMemory.createCandidate({
      ...values, content: `${marker}-2`,
      evidenceLineage: [{ ...evidence[0], sourceId: `${marker}-2` }], transaction: tx,
    });
    rolledBackIds.push(first.id, second.id);
    const events = await tx.select().from(aiceoMemoryEventsTable)
      .where(inArray(aiceoMemoryEventsTable.candidateId, [first.id, second.id]))
      .orderBy(asc(aiceoMemoryEventsTable.appendSequence));
    assert.equal(events.length, 2);
    assert.equal(events[0].candidateId, first.id);
    assert.equal(events[0].eventType, "candidate_created");
    assert.equal(events[0].actorId, values.sourceActorId);
    assert.match(events[0].eventHash, /^[a-f0-9]{64}$/);
    assert.equal(events[1].appendSequence, events[0].appendSequence + 1);
    assert.equal(events[1].candidateId, second.id);
    assert.equal(events[1].previousHash, events[0].eventHash);
  });

  await rejected("fact laundering", /type-state|untrusted source/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoMemoryCandidatesTable).values({ ...values, memoryType: "fact", cognitiveState: "observation" });
  }));
  await rejected("decision laundering", /type-state|untrusted source/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoMemoryCandidatesTable).values({ ...values, memoryType: "decision", cognitiveState: "decision" });
  }));
  await rejected("trusted truth", /untrusted source/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoMemoryCandidatesTable).values({ ...values, truthLevel: "verified" });
  }));
  await rejected("empty evidence", /evidence lineage is required/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoMemoryCandidatesTable).values({ ...values, evidenceLineage: [] });
  }));
  await rejected("malformed evidence", /provenance shape/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoMemoryCandidatesTable).values({
      ...values, evidenceLineage: [{ ...evidence[0], evidenceHash: "bad" }],
    });
  }));
  await rejected("future evidence", /temporal validity/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoMemoryCandidatesTable).values({
      ...values, evidenceLineage: [{ ...evidence[0], observedAt: new Date(Date.now() + 60_000).toISOString() }],
    });
  }));
  await rejected("expired evidence", /temporal validity/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoMemoryCandidatesTable).values({
      ...values, evidenceLineage: [{ ...evidence[0], validUntil: new Date(Date.now() - 1000).toISOString() }],
    });
  }));
  await rejected("future evidence validFrom", /temporal validity/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoMemoryCandidatesTable).values({
      ...values,
      evidenceLineage: [{
        ...evidence[0],
        validFrom: new Date(Date.now() + 60_000).toISOString(),
        validUntil: new Date(Date.now() + 120_000).toISOString(),
      }],
    });
  }));
  assert.throws(() => assertEvidenceValid([]), /requires evidence lineage/);
  assert.throws(() => assertEvidenceValid([{ ...evidence[0], observedAt: new Date(Date.now() + 60_000).toISOString() }]), /future/);

  await rejected("noncanonical project", /canonical AICEO project/, () => db.transaction(async (tx) => {
    const [other] = await tx.insert(aiceoContinuityProjectsTable).values({
      projectKey: `other-${randomUUID()}`, title: "other", purpose: "negative isolation test",
    }).returning();
    await tx.insert(aiceoMemoryCandidatesTable).values({ ...values, projectId: other.id });
  }));

  for (const [name, patch] of [
    ["queue inactive", { queueActive: false }],
    ["kill switch", { killSwitch: true }],
    ["circuit open", { circuitState: "OPEN" }],
    ["circuit half open", { circuitState: "HALF_OPEN" }],
  ] as const) {
    await rejected(name, /control gate|kill switch/, () => db.transaction(async (tx) => {
      await tx.update(aiceoControlStateTable).set(patch);
      await tx.insert(aiceoMemoryCandidatesTable).values(values);
    }));
  }

  await rejected("candidate update", /immutable/, () => db.transaction(async (tx) => {
    const [row] = await tx.insert(aiceoMemoryCandidatesTable).values(values).returning();
    await tx.update(aiceoMemoryCandidatesTable).set({ content: "tampered" })
      .where(eq(aiceoMemoryCandidatesTable.id, row.id));
  }));
  await rejected("candidate delete", /immutable/, () => db.transaction(async (tx) => {
    const [row] = await tx.insert(aiceoMemoryCandidatesTable).values(values).returning();
    await tx.delete(aiceoMemoryCandidatesTable).where(eq(aiceoMemoryCandidatesTable.id, row.id));
  }));
  await rejected("direct event", /candidate lifecycle|accepts only|not bound/, () => db.transaction(async (tx) => {
    await tx.insert(aiceoMemoryEventsTable).values({
      projectId: project.id, eventType: "arbitrary", actorId: "attacker",
      actorAuthority: "ordinary_agent", payload: {}, eventHash: "b".repeat(64),
    });
  }));
  await rejected("promoted insert", /Learning Promotion is DEFERRED/, () => db.transaction(async (tx) => {
    const [candidate] = await tx.insert(aiceoMemoryCandidatesTable).values(values).returning();
    await tx.insert(aiceoPromotedMemoriesTable).values({
      candidateId: candidate.id, candidateProjectId: project.id, projectId: project.id,
      content: candidate.content, memoryLayer: "semantic", memoryType: "fact", cognitiveState: "fact",
      truthLevel: "verified", authorityLevel: "brain", evidenceLineage: evidence,
      promotedBy: "attacker", productionAuthority: false,
    });
  }));
  await rejected("service promotion", /Learning Promotion is DEFERRED/, () =>
    aiceoMemory.promoteCandidate({
      projectId: project.id, candidateId: randomUUID(), actorId: "attacker", actorAuthority: "owner",
    }));

  assert.equal((await db.select().from(aiceoMemoryCandidatesTable)
    .where(inArray(aiceoMemoryCandidatesTable.id, rolledBackIds))).length, 0);
  assert.equal((await db.select().from(aiceoMemoryEventsTable)
    .where(inArray(aiceoMemoryEventsTable.candidateId, rolledBackIds))).length, 0);
  await pool.end();
  console.log("AICEO G1-001 candidate-only integration: PASS (targeted negatives, linear events, zero residue)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});