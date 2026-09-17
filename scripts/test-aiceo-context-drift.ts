import assert from "node:assert/strict";
import { asc, eq } from "drizzle-orm";
import {
  aiceoContextEvidenceEventsTable, aiceoContinuityProjectsTable,
  aiceoContinuityStateTable, db, pool,
} from "@workspace/db";
import {
  AiceoContinuityLayer, CONTEXT_AUTHORITY_CONTINUITY_RULE,
} from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

const errorText = (error: unknown): string =>
  error instanceof Error ? `${error.message} ${error.cause ? errorText(error.cause) : ""}` : String(error);
const rejects = async (pattern: RegExp, work: () => Promise<unknown>) => {
  try { await work(); assert.fail("unexpected success"); } catch (error) { assert.match(errorText(error), pattern); }
};

async function main() {
  const [project] = await db.select().from(aiceoContinuityProjectsTable)
    .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).limit(1);
  const [before] = project ? await db.select().from(aiceoContinuityStateTable)
    .where(eq(aiceoContinuityStateTable.projectId, project.id)).limit(1) : [];
  assert.ok(project && before);
  assert.ok(before.revision >= 40);
  assert.equal(before.currentState.verification, "NOT_VERIFIED");
  assert.equal(before.currentState.closure, "BLOCKED");
  const layer = new AiceoContinuityLayer();
  const existingEvents = await db.select().from(aiceoContextEvidenceEventsTable)
    .where(eq(aiceoContextEvidenceEventsTable.projectId, project.id))
    .orderBy(asc(aiceoContextEvidenceEventsTable.appendSequence));

  const drifted = await layer.resume("Bro，继续", "aiceo_owner", {
    source: "work",
    context: {
      provider: "Work/Notion",
      recentContextClaim: "AICEO is entering Architecture Phase / next Grok Agent Integration Contract",
      classification: "candidate_context_only",
    },
    claimedPhase: "Architecture Phase",
    claimedTask: "Grok Agent Integration Contract",
    claimedNextStep: "next Grok Agent Integration Contract",
    claimedRevision: 12,
    observedAt: new Date("2026-09-17T14:30:00.000Z"),
  });
  assert.equal(drifted.truthSource, "persistent_state");
  assert.equal(drifted.persistentEvidenceVerified, true);
  assert.equal(drifted.state.revision, before.revision);
  assert.equal(drifted.state.resumeNode.node, before.resumeNode.node);
  assert.match(String(drifted.state.currentState.activeTask ?? drifted.state.currentState.completedTask), /G1-001/);
  assert.notEqual(drifted.state.currentState.activeTask, "Architecture Phase");
  assert.notEqual(drifted.resume.node.node, "next Grok Agent Integration Contract");
  assert.equal(drifted.contextAuthority.disposition, "context_drift_rejected");
  assert.deepEqual(drifted.contextAuthority.conflictFields, ["phase","task","next_step","revision"]);
  assert.equal(drifted.contextAuthority.stateOverrideAccepted, false);
  assert.equal(drifted.contextAuthority.memoryRole, "why_history_context_only");
  assert.equal(drifted.productionAuthority, false);

  for (const alias of ["AICEO继续", "Bro，继续"]) {
    const resumed = await layer.resume(alias, "aiceo_operator");
    assert.equal(resumed.state.revision, before.revision);
    assert.equal(resumed.state.resumeNode.node, before.resumeNode.node);
    assert.deepEqual(resumed.state.decisionRuleRegistry, before.decisionRuleRegistry);
    assert.equal(resumed.contextAuthority.disposition, "persistent_state_recovery");
    assert.equal(resumed.contextAuthority.stateOverrideAccepted, false);
  }
  const aligned = await layer.resume("AICEO继续", "aiceo_validator", {
    source: "new_chat",
    context: { utterance: "AICEO继续", memoryPurpose: "why/history only" },
    claimedTask: String(before.currentState.activeTask),
    claimedNextStep: String(before.resumeNode.node),
    claimedRevision: before.revision,
    observedAt: new Date("2026-09-17T14:31:00.000Z"),
  });
  assert.equal(aligned.contextAuthority.disposition, "candidate_context_only");
  assert.deepEqual(aligned.contextAuthority.conflictFields, []);
  const concurrent = await Promise.all(["notion","ordinary_chat","agent","future_ai","connector"].map((source) =>
    layer.resume("Bro，继续", "aiceo_validator", {
      source: source as "notion" | "ordinary_chat" | "agent" | "future_ai" | "connector",
      context: { source, recentContext: "candidate evidence only" },
      claimedRevision: before.revision,
      observedAt: new Date("2026-09-17T14:32:00.000Z"),
    })));
  assert.ok(concurrent.every((result) =>
    result.state.revision === before.revision
    && result.contextAuthority.disposition === "candidate_context_only"
    && result.contextAuthority.stateOverrideAccepted === false));

  const events = await db.select().from(aiceoContextEvidenceEventsTable)
    .where(eq(aiceoContextEvidenceEventsTable.projectId, project.id))
    .orderBy(asc(aiceoContextEvidenceEventsTable.appendSequence));
  assert.equal(events.length, existingEvents.length + 7);
  const added = events.slice(-7);
  assert.deepEqual(added.map((event) => Number(event.appendSequence)),
    Array.from({ length: 7 }, (_, index) => existingEvents.length + index + 1));
  assert.equal(added[0].previousHash, existingEvents.at(-1)?.eventHash ?? null);
  for (let index = 1; index < added.length; index += 1) {
    assert.equal(added[index].previousHash, added[index - 1].eventHash);
  }
  assert.ok(added.every((event) =>
    !event.operationalInput && !event.stateOverrideAccepted && !event.grantsAuthority &&
    !event.productionAuthority && event.persistentRevision === before.revision &&
    event.verifiedResumeNode.node === before.resumeNode.node &&
    /^[a-f0-9]{64}$/.test(event.eventHash) && /^[a-f0-9]{64}$/.test(event.persistentStateHash)));
  assert.deepEqual(await layer.verifyContextEvidenceIntegrity(project.id), {
    count: events.length,
    drift_count: events.filter((event) => event.disposition === "context_drift_rejected").length,
    valid: true,
  });
  await rejects(/append-only/, () => db.update(aiceoContextEvidenceEventsTable)
    .set({ disposition: "candidate_context_only" }).where(eq(aiceoContextEvidenceEventsTable.id, added[0].id)));
  await rejects(/append-only/, () => db.delete(aiceoContextEvidenceEventsTable)
    .where(eq(aiceoContextEvidenceEventsTable.id, added[0].id)));
  const [after] = await db.select().from(aiceoContinuityStateTable)
    .where(eq(aiceoContinuityStateTable.projectId, project.id)).limit(1);
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.currentState, before.currentState);
  assert.deepEqual(after.resumeNode, before.resumeNode);
  assert.deepEqual(after.decisionRuleRegistry.find((rule: any) =>
    rule.id === CONTEXT_AUTHORITY_CONTINUITY_RULE.id), CONTEXT_AUTHORITY_CONTINUITY_RULE);
  await pool.end();
  console.log("AICEO G1-001 context drift: PASS (external context candidate-only, Persistent State restored)");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });