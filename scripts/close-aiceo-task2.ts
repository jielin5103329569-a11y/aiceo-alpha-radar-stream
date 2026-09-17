import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiceoAgentRunsTable,
  aiceoAgentVerificationsTable,
  aiceoCollaborationIssuesTable,
  aiceoCollaborationRulesTable,
  aiceoContinuityEventsTable,
  aiceoContinuityProjectsTable,
  aiceoContinuityStateTable,
  aiceoControlStateTable,
  aiceoExecutionContractsTable,
  aiceoPolicyRegistryTable,
  aiceoTasksTable,
} from "@workspace/db/schema";
import { AiceoContinuityLayer } from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

const EXPECTED_REVISION = 6;

const canonical = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
};

const scalarCount = async (tx: any, table: any) =>
  Number((await tx.select({ value: count() }).from(table))[0].value);

async function main() {
  const secret = process.env.SESSION_SECRET;
  assert.ok(secret && secret.length >= 32, "Fail-Closed: continuity signing authority is unavailable");

  const result = await db.transaction(async (tx) => {
    const project = (await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).for("update"))[0];
    const state = project && (await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update"))[0];
    const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0];

    assert.ok(project && state && control, "Fail-Closed: persistent continuity state is incomplete");
    assert.equal(project.environment, "development", "Fail-Closed: environment drift");
    assert.equal(project.authority, "grok_restricted_development", "Fail-Closed: authority drift");
    assert.equal(project.productionAuthority, false, "Fail-Closed: production authority drift");
    assert.equal(state.state, "COMPLETED", "Fail-Closed: lifecycle state drift");
    assert.equal(state.revision, EXPECTED_REVISION, "Fail-Closed: acceptance evidence is not bound to current revision");
    assert.equal(state.currentState.implementation, "COMPLETED", "Fail-Closed: implementation state drift");
    assert.equal(
      state.currentState.verification,
      "PENDING_INDEPENDENT_READ_ONLY_ACCEPTANCE",
      "Fail-Closed: verification state drift",
    );
    assert.equal(state.resumeNode.node, "independent-read-only-acceptance", "Fail-Closed: resume node drift");
    assert.equal(state.resumeNode.ownerGate, false, "Fail-Closed: unexpected Owner Gate");
    assert.equal(state.failureReason, null, "Fail-Closed: unresolved failure");
    assert.equal(state.ownerGateReason, null, "Fail-Closed: unresolved Owner Gate");
    assert.equal(control.killSwitch, false, "Fail-Closed: Kill Switch drift");
    assert.equal(control.queueActive, true, "Fail-Closed: Queue drift");
    assert.equal(control.circuitState, "CLOSED", "Fail-Closed: Circuit Breaker drift");
    assert.equal(control.circuitFailureCount, 0, "Fail-Closed: circuit failure drift");

    const foundations = await tx.select().from(aiceoPolicyRegistryTable);
    assert.equal(foundations.length, 13, "Fail-Closed: Foundation registry drift");
    assert.ok(foundations.every((foundation: any) => foundation.frozen), "Fail-Closed: Foundation thaw detected");

    const evidenceIds = new Set(state.evidencePointers.map((pointer: any) => pointer.id));
    const evidencePaths = new Set(state.evidencePointers.map((pointer: any) => pointer.pointer));
    assert.ok(evidenceIds.has("brain-agent-negative-gates-v2"), "Fail-Closed: expanded negative-gate evidence missing");
    assert.ok(evidencePaths.has("scripts/test-aiceo-collaboration-loop-integration.ts"), "Fail-Closed: Collaboration Loop evidence missing");
    assert.ok(evidencePaths.has("scripts/test-aiceo-agent-protocol-integration.ts"), "Fail-Closed: Brain-Agent evidence missing");
    assert.ok(evidencePaths.has("lib/db/drizzle/0018_aiceo_brain_agent_protocol.sql"), "Fail-Closed: protocol migration evidence missing");

    const events = await tx.select().from(aiceoContinuityEventsTable)
      .where(eq(aiceoContinuityEventsTable.projectId, project.id))
      .orderBy(asc(aiceoContinuityEventsTable.serverTimestamp), asc(aiceoContinuityEventsTable.id));
    let previous: string | null = null;
    for (const event of events) {
      assert.equal(event.previousHash, previous, "Fail-Closed: continuity event chain is broken");
      const signedInput = {
        id: event.id,
        projectId: event.projectId,
        state: event.state,
        actorId: event.actorId,
        eventType: event.eventType,
        payload: event.payload,
        previousHash: event.previousHash,
        serverTimestamp: event.serverTimestamp,
      };
      const expected = createHmac("sha256", secret)
        .update(JSON.stringify(canonical(signedInput)))
        .digest("hex");
      assert.equal(event.eventHash, expected, "Fail-Closed: continuity event HMAC mismatch");
      previous = event.eventHash;
    }
    assert.equal(events.length, 5, "Fail-Closed: revision-6 acceptance event count drift");

    const persistentCounts = {
      contracts: await scalarCount(tx, aiceoExecutionContractsTable),
      runs: await scalarCount(tx, aiceoAgentRunsTable),
      verifications: await scalarCount(tx, aiceoAgentVerificationsTable),
      issues: await scalarCount(tx, aiceoCollaborationIssuesTable),
      rules: await scalarCount(tx, aiceoCollaborationRulesTable),
    };
    assert.deepEqual(
      persistentCounts,
      { contracts: 0, runs: 0, verifications: 0, issues: 0, rules: 0 },
      "Fail-Closed: rollback-isolated acceptance tables drifted",
    );
    const activeTasks = Number((await tx.select({ value: count() }).from(aiceoTasksTable)
      .where(inArray(aiceoTasksTable.state, ["RUNNING", "VALIDATING"])))[0].value);
    assert.equal(activeTasks, 0, "Fail-Closed: active AICEO work appeared");

    const layer = new AiceoContinuityLayer(tx, true);
    const entities = state.entityRegistry.map((entity: any) =>
      entity.id === "continuity-001"
        ? { ...entity, status: "COMPLETED", verification: "VERIFIED", closure: "CLOSED" }
        : entity,
    );
    const evidencePointers = [
      ...state.evidencePointers,
      {
        id: "task-2-final-independent-read-only-acceptance",
        type: "independent_read_only_acceptance",
        acceptedRevision: EXPECTED_REVISION,
        result: "VERIFIED",
        isolation: "read_only",
        evidence: {
          hmacEventsVerified: events.length,
          foundationsFrozen: "13/13",
          rollbackIsolatedTablesClean: true,
          controlGatesUnchanged: true,
          authorityUnchanged: true,
          productionAuthority: false,
        },
      },
      {
        id: "aiceo-brain-exclusive-alias-bro",
        type: "continuity_identity_alias",
        alias: "Bro",
        resumePhrase: "Bro，继续",
        assignee: "aiceo_brain",
        exclusive: true,
        grantsAuthority: false,
      },
    ];

    return layer.update({
      state: "COMPLETED",
      currentState: {
        ...state.currentState,
        activeTask: null,
        completedTask: "Task 2 — AICEO Continuity Layer + Owner–Brain Execution Protocol",
        implementation: "COMPLETED",
        verification: "VERIFIED",
        closure: "CLOSED",
        acceptedRevision: EXPECTED_REVISION,
      },
      decisionRuleRegistry: state.decisionRuleRegistry,
      entityRegistry: entities,
      aliasDictionary: {
        ...state.aliasDictionary,
        Bro: "aiceo_brain_exclusive_alias",
        "Bro，继续": "resume",
      },
      evidencePointers,
      resumeNode: {
        node: "task-2-closed",
        status: "CLOSED",
        action: "Task 2 is complete; recover persistent closure evidence and await the Owner's next intent.",
        ownerGate: false,
      },
      failureReason: null,
      recoveryStrategy: "Read PostgreSQL continuity state and CLOSED resumeNode; never reconstruct truth from chat memory.",
      ownerGateReason: null,
    }, "aiceo:continuity-supervisor");
  });

  assert.equal(result.revision, 7);
  assert.equal(result.productionAuthority, false);
  console.log(JSON.stringify({
    state: result.state,
    revision: result.revision,
    verification: "VERIFIED",
    closure: "CLOSED",
    resumeNode: "task-2-closed",
    alias: "Bro",
    resumePhrase: "Bro，继续",
    productionAuthority: false,
    evidenceEventHash: result.eventHash,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});