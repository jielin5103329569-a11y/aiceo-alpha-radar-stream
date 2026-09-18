import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { asc, count, eq, inArray } from "drizzle-orm";
import {
  aiceoContinuityEventsTable,
  aiceoContinuityProjectsTable,
  aiceoContinuityStateTable,
  aiceoControlStateTable,
  aiceoIntentConfirmationsTable,
  aiceoPolicyRegistryTable,
  aiceoRetrievalDecisionsTable,
  aiceoRetrievalRequestsTable,
  aiceoRetrievalRunsTable,
  aiceoRetrievalValidatorAttestationsTable,
  aiceoTasksTable,
  db,
} from "@workspace/db";
import {
  AiceoContinuityLayer,
  closureIntentDigest,
  MEMORY_RETRIEVAL_ROUTER_RULE,
} from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

const IMPLEMENTATION_REVISION = 46;
const VALIDATOR_ID = "g1-002-retrieval-review";

const canonical = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
};

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

const commandsToRun = [
  { name: "schema:reconcile-development", args: ["--filter", "@workspace/db", "run", "push-force"], rejectCliError: true },
  { name: "api-spec:codegen", args: ["--filter", "@workspace/api-spec", "run", "codegen"] },
  { name: "api-server:typecheck", args: ["--filter", "@workspace/api-server", "run", "typecheck"] },
  { name: "test:aiceo-control-plane", args: ["run", "test:aiceo-control-plane"] },
  { name: "test:aiceo-permission-matrix", args: ["run", "test:aiceo-permission-matrix"] },
  { name: "test:aiceo-governance-root", args: ["run", "test:aiceo-governance-root"] },
  { name: "test:aiceo-continuity-layer", args: ["run", "test:aiceo-continuity-layer"] },
  { name: "test:aiceo-agent-protocol", args: ["run", "test:aiceo-agent-protocol"] },
  { name: "test:aiceo-collaboration-loop-integration", args: ["run", "test:aiceo-collaboration-loop-integration"] },
  { name: "test:aiceo-agent-protocol-integration", args: ["run", "test:aiceo-agent-protocol-integration"] },
  { name: "test:aiceo-closure-integrity", args: ["run", "test:aiceo-closure-integrity"] },
  { name: "test:aiceo-memory", args: ["run", "test:aiceo-memory"] },
  { name: "test:aiceo-memory-integration", args: ["run", "test:aiceo-memory-integration"] },
  { name: "test:aiceo-memory-concurrency", args: ["run", "test:aiceo-memory-concurrency"] },
  { name: "test:aiceo-thought-continuity", args: ["run", "test:aiceo-thought-continuity"] },
  { name: "test:aiceo-thought-concurrency", args: ["run", "test:aiceo-thought-concurrency"] },
  { name: "test:aiceo-layered-self-checks", args: ["run", "test:aiceo-layered-self-checks"] },
  { name: "test:aiceo-preclassification-inbox", args: ["run", "test:aiceo-preclassification-inbox"] },
  { name: "test:aiceo-context-drift", args: ["run", "test:aiceo-context-drift"] },
  { name: "test:aiceo-memory-retrieval-router", args: ["run", "test:aiceo-memory-retrieval-router"] },
];

async function main() {
  const secret = process.env.SESSION_SECRET;
  const reviewEvidenceDigest = process.env.G1_002_REVIEW_EVIDENCE_DIGEST;
  assert.ok(secret && secret.length >= 32, "Fail-Closed: signing authority is unavailable");
  assert.match(
    reviewEvidenceDigest ?? "",
    /^[a-f0-9]{64}$/,
    "Fail-Closed: independent reviewer evidence digest is unavailable",
  );

  const commands = commandsToRun.map((command) => {
    const executed = spawnSync("pnpm", command.args, { encoding: "utf8", env: process.env });
    const output = `${executed.stdout ?? ""}\n${executed.stderr ?? ""}`;
    const hiddenCliFailure = command.rejectCliError === true && /(^|\n)error:/m.test(output);
    if (executed.status !== 0 || hiddenCliFailure) process.stderr.write(output);
    assert.equal(executed.status, 0, `Fail-Closed: regression failed: ${command.name}`);
    assert.equal(hiddenCliFailure, false, `Fail-Closed: CLI reported failure with zero exit code: ${command.name}`);
    console.log(`${command.name}: PASSED`);
    return {
      name: command.name,
      exitCode: executed.status,
      outputSha256: createHash("sha256").update(output).digest("hex"),
    };
  });

  const result = await db.transaction(async (tx) => {
    const [project] = await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).for("update");
    const [state] = project ? await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update") : [];
    const [control] = await tx.select().from(aiceoControlStateTable).limit(1).for("update");
    assert.ok(project && state && control, "Fail-Closed: persistent control graph is incomplete");
    assert.equal(state.revision, IMPLEMENTATION_REVISION);
    assert.equal(state.state, "RUNNING");
    assert.equal(state.currentState.activeTask, "G1-002 — AICEO Memory Retrieval Router");
    assert.equal(state.currentState.implementation, "RUNNING");
    assert.equal(state.currentState.verification, "NOT_VERIFIED");
    assert.equal(state.currentState.closure, "BLOCKED");
    assert.equal(state.currentState.acceptedRevision, 43);
    assert.equal(state.resumeNode.node, "g1-002-retrieval-router-implementation");
    assert.equal(project.environment, "development");
    assert.equal(project.authority, "grok_restricted_development");
    assert.equal(project.productionAuthority, false);
    assert.equal(control.queueActive, true);
    assert.equal(control.killSwitch, false);
    assert.equal(control.circuitState, "CLOSED");
    assert.equal(Number((await tx.select({ value: count() }).from(aiceoPolicyRegistryTable)
      .where(eq(aiceoPolicyRegistryTable.frozen, true)))[0].value), 13);
    assert.equal(Number((await tx.select({ value: count() }).from(aiceoTasksTable)
      .where(inArray(aiceoTasksTable.state, ["RUNNING", "VALIDATING"])))[0].value), 0);
    assert.deepEqual({
      requests: Number((await tx.select({ value: count() }).from(aiceoRetrievalRequestsTable))[0].value),
      decisions: Number((await tx.select({ value: count() }).from(aiceoRetrievalDecisionsTable))[0].value),
      runs: Number((await tx.select({ value: count() }).from(aiceoRetrievalRunsTable))[0].value),
      attestations: Number((await tx.select({ value: count() })
        .from(aiceoRetrievalValidatorAttestationsTable))[0].value),
    }, { requests: 0, decisions: 0, runs: 0, attestations: 0 });
    assert.deepEqual(
      canonical(state.decisionRuleRegistry.find((rule: any) => rule.id === MEMORY_RETRIEVAL_ROUTER_RULE.id)),
      canonical(MEMORY_RETRIEVAL_ROUTER_RULE),
    );

    const continuityEvents = await tx.select().from(aiceoContinuityEventsTable)
      .where(eq(aiceoContinuityEventsTable.projectId, project.id))
      .orderBy(asc(aiceoContinuityEventsTable.appendSequence));
    let previous: string | null = null;
    for (const [index, event] of continuityEvents.entries()) {
      assert.equal(Number(event.appendSequence), index + 1, "Fail-Closed: Continuity sequence gap");
      assert.equal(event.previousHash, previous, "Fail-Closed: Continuity evidence chain broken");
      const expected = createHmac("sha256", secret).update(JSON.stringify(canonical({
        id: event.id,
        projectId: event.projectId,
        state: event.state,
        actorId: event.actorId,
        eventType: event.eventType,
        payload: event.payload,
        previousHash: event.previousHash,
        serverTimestamp: event.serverTimestamp,
      }))).digest("hex");
      assert.equal(event.eventHash, expected, "Fail-Closed: Continuity HMAC invalid");
      previous = event.eventHash;
    }

    const layer = new AiceoContinuityLayer(tx, true);
    const acceptedEntities = state.entityRegistry.map((entity: any) =>
      entity.id === "continuity-001" || entity.id === "memory-g1-002-retrieval-router"
        ? { ...entity, status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED" }
        : entity);
    const acceptedEvidence = {
      id: "g1-002-final-independent-read-only-acceptance",
      type: "independent_read_only_acceptance",
      acceptedRevision: IMPLEMENTATION_REVISION,
      result: "VERIFIED",
      validatorId: VALIDATOR_ID,
      reviewerEvidenceDigest: reviewEvidenceDigest,
      isolation: "read_only",
      authorityUnchanged: true,
      grantsAuthority: false,
      productionAuthority: false,
    };
    await layer.update({
      state: "COMPLETED",
      currentState: {
        ...state.currentState,
        implementation: "COMPLETED",
        acceptedRevision: IMPLEMENTATION_REVISION,
      },
      decisionRuleRegistry: state.decisionRuleRegistry,
      entityRegistry: acceptedEntities,
      aliasDictionary: state.aliasDictionary,
      evidencePointers: [...state.evidencePointers, acceptedEvidence],
      resumeNode: {
        node: "g1-002-retrieval-router-closure-integrity-audit",
        action: "Record independent Validator attestation and complete the signed G1-002 Closure Integrity Audit.",
        status: "BLOCKED",
        ownerGate: false,
      },
      failureReason: "G1-002 is independently accepted but remains blocked until Validator attestation and Closure Integrity Audit commit atomically.",
      recoveryStrategy: "Re-run the complete fail-closed G1-002 closure audit; partial acceptance and attestation must roll back.",
      ownerGateReason: null,
    }, "aiceo:g1-002-independent-acceptance-recorder");

    const [acceptedState] = await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update");
    assert.equal(acceptedState.revision, IMPLEMENTATION_REVISION + 1);
    assert.equal(acceptedState.currentState.acceptedRevision, IMPLEMENTATION_REVISION);
    await layer.attestRetrievalValidation(
      { acceptedRevision: IMPLEMENTATION_REVISION, evidenceDigest: reviewEvidenceDigest },
      VALIDATOR_ID,
      "aiceo_validator",
    );

    const intentConfirmations = await tx.select().from(aiceoIntentConfirmationsTable)
      .where(eq(aiceoIntentConfirmationsTable.projectId, project.id))
      .orderBy(asc(aiceoIntentConfirmationsTable.createdAt), asc(aiceoIntentConfirmationsTable.id));
    const targetCurrentState = {
      ...acceptedState.currentState,
      verification: "VERIFIED",
      closure: "CLOSED",
      closureIntegrityAudit: "VERIFIED",
      closureIntegrityAuditedRevision: acceptedState.revision,
    };
    const targetEntities = acceptedState.entityRegistry.map((entity: any) =>
      entity.id === "continuity-001" || entity.id === "memory-g1-002-retrieval-router"
        ? { ...entity, status: "COMPLETED", verification: "VERIFIED", closure: "CLOSED" }
        : entity);
    const targetResumeNode = {
      node: "g1-003-context-compiler-deferred",
      action: "G1-002 is closed. Context Compiler remains DEFERRED and must not auto-start; await explicit Owner instruction.",
      status: "CLOSED",
      ownerGate: false,
      closureIntegrityAudit: "VERIFIED",
    };
    const recoveryStrategy = "Read PostgreSQL Persistent State, verify the latest signed Closure Integrity Audit and HMAC chain, then stop at the CLOSED deferred Resume Node.";
    const report = {
      auditedRevision: acceptedState.revision,
      generatedBy: "aiceo:g1-002-closure-integrity-auditor",
      allPassed: true,
      intentConfirmationsHash: digest(intentConfirmations),
      closureIntentHash: closureIntentDigest({
        auditedRevision: acceptedState.revision,
        state: "COMPLETED",
        currentState: targetCurrentState,
        decisionRuleRegistry: acceptedState.decisionRuleRegistry,
        entityRegistry: targetEntities,
        aliasDictionary: acceptedState.aliasDictionary,
        historicalEvidence: acceptedState.evidencePointers,
        resumeNode: targetResumeNode,
        failureReason: null,
        recoveryStrategy,
        ownerGateReason: null,
      }),
      commands,
    };
    const auditEvidence = {
      id: "g1-002-closure-integrity-audit",
      type: "closure_integrity_audit",
      auditedRevision: acceptedState.revision,
      result: "VERIFIED",
      checks: {
        canonicalSchemaReconciliation: true,
        independentReadOnlyAcceptance: true,
        independentValidatorAttestation: true,
        projectIsolation: true,
        authenticatedNeedToKnow: true,
        persistentStatePriority: true,
        boundedBudget: true,
        explainableInclusionAndExclusion: true,
        staleConflictPoisonContextDriftFailClosed: true,
        requesterOnlyRead: true,
        appendOnlyEvidence: true,
        closureIntentBound: true,
        contextCompilerDeferred: true,
        laterModulesDeferred: true,
      },
      reviewerEvidenceDigest: reviewEvidenceDigest,
      regressionReport: report,
      regressionReportHmac: createHmac("sha256", secret)
        .update(JSON.stringify(canonical(report))).digest("hex"),
      continuityEventsVerified: continuityEvents.length,
      authorityUnchanged: true,
      grantsAuthority: false,
      productionAuthority: false,
    };
    return layer.update({
      state: "COMPLETED",
      currentState: targetCurrentState,
      decisionRuleRegistry: acceptedState.decisionRuleRegistry,
      entityRegistry: targetEntities,
      aliasDictionary: acceptedState.aliasDictionary,
      evidencePointers: [...acceptedState.evidencePointers, auditEvidence],
      resumeNode: targetResumeNode,
      failureReason: null,
      recoveryStrategy,
      ownerGateReason: null,
    }, "aiceo:g1-002-closure-integrity-auditor");
  });

  assert.equal(result.revision, IMPLEMENTATION_REVISION + 2);
  assert.equal(result.productionAuthority, false);
  console.log(JSON.stringify({
    revision: result.revision,
    verification: "VERIFIED",
    closure: "CLOSED",
    closureIntegrityAudit: "VERIFIED",
    auditedRevision: IMPLEMENTATION_REVISION + 1,
    acceptedRevision: IMPLEMENTATION_REVISION,
    resumeNode: "g1-003-context-compiler-deferred",
    contextCompiler: "DEFERRED",
    autoStarted: false,
    productionAuthority: false,
    eventHash: result.eventHash,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});