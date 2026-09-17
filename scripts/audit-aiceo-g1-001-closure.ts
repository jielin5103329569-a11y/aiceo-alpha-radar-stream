import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { asc, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiceoContinuityEventsTable, aiceoContinuityProjectsTable, aiceoContinuityStateTable,
  aiceoControlStateTable, aiceoIntentConfirmationsTable, aiceoMemoryCandidatesTable,
  aiceoMemoryEventsTable, aiceoPolicyRegistryTable, aiceoPromotedMemoriesTable,
  aiceoTasksTable, aiceoThoughtNodesTable,
  aiceoSelfCheckReportsTable, aiceoSelfCheckChainContractsTable,
  aiceoPreclassificationMemoryInboxTable, aiceoPreclassificationSeedManifestTable,
  aiceoContextEvidenceEventsTable,
} from "@workspace/db/schema";
import {
  AiceoContinuityLayer, closureIntentDigest, LAYERED_SELF_CHECK_RULE, MEMORY_FOUNDATION_RULE,
  PRECLASSIFICATION_MEMORY_INBOX_RULE, CONTEXT_AUTHORITY_CONTINUITY_RULE,
} from "../artifacts/api-server/src/lib/aiceoContinuityLayer";
import { aiceoPreclassificationInbox } from "../artifacts/api-server/src/lib/aiceoPreclassificationInbox";

const AUDITED_REVISION = 44;
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

async function main() {
  const secret = process.env.SESSION_SECRET;
  assert.ok(secret && secret.length >= 32, "Fail-Closed: signing authority is unavailable");
  const commands = [
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
  ].map((command) => {
    const executed = spawnSync("pnpm", command.args, { encoding: "utf8", env: process.env });
    const output = `${executed.stdout ?? ""}\n${executed.stderr ?? ""}`;
    if (executed.status !== 0) process.stderr.write(output);
    assert.equal(executed.status, 0, `Fail-Closed: regression failed: ${command.name}`);
    console.log(`${command.name}: PASSED`);
    return {
      name: command.name,
      exitCode: executed.status,
      outputSha256: createHash("sha256").update(output).digest("hex"),
    };
  });

  const result = await db.transaction(async (tx) => {
    const project = (await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).for("update"))[0];
    const state = project && (await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update"))[0];
    const control = (await tx.select().from(aiceoControlStateTable).limit(1).for("update"))[0];
    assert.ok(project && state && control, "Fail-Closed: persistent control graph is incomplete");
    assert.equal(state.revision, AUDITED_REVISION);
    assert.equal(state.currentState.verification, "NOT_VERIFIED");
    assert.equal(state.currentState.closure, "BLOCKED");
    assert.equal(state.currentState.acceptedRevision, 43);
    assert.equal(state.resumeNode.node, "g1-001-context-authority-closure-integrity-audit");
    assert.equal(project.environment, "development");
    assert.equal(project.authority, "grok_restricted_development");
    assert.equal(project.productionAuthority, false);
    assert.equal(control.queueActive, true);
    assert.equal(control.killSwitch, false);
    assert.equal(control.circuitState, "CLOSED");

    const foundations = await tx.select().from(aiceoPolicyRegistryTable);
    assert.equal(foundations.length, 13);
    assert.ok(foundations.every((item: any) => item.frozen));
    const activeTasks = Number((await tx.select({ value: count() }).from(aiceoTasksTable)
      .where(inArray(aiceoTasksTable.state, ["RUNNING", "VALIDATING"])))[0].value);
    assert.equal(activeTasks, 0);

    const memoryCounts = {
      candidates: Number((await tx.select({ value: count() }).from(aiceoMemoryCandidatesTable))[0].value),
      promoted: Number((await tx.select({ value: count() }).from(aiceoPromotedMemoriesTable))[0].value),
      activeEvents: Number((await tx.select({ value: count() }).from(aiceoMemoryEventsTable))[0].value),
      thoughts: Number((await tx.select({ value: count() }).from(aiceoThoughtNodesTable))[0].value),
      selfChecks: Number((await tx.select({ value: count() }).from(aiceoSelfCheckReportsTable))[0].value),
      preclassificationInbox: Number((await tx.select({ value: count() }).from(aiceoPreclassificationMemoryInboxTable))[0].value),
    };
    assert.deepEqual(memoryCounts, { candidates: 0, promoted: 0, activeEvents: 0, thoughts: 0, selfChecks: 0, preclassificationInbox: 8 });
    assert.equal(Number((await tx.select({ value: count() }).from(aiceoPreclassificationSeedManifestTable))[0].value), 8);
    assert.deepEqual(await aiceoPreclassificationInbox.verifyIntegrity(project.id, tx), { count: 8, valid: true });
    const layer = new AiceoContinuityLayer(tx, true);
    const contextIntegrity = await layer.verifyContextEvidenceIntegrity(project.id, tx);
    assert.ok(contextIntegrity.count >= 2 && contextIntegrity.drift_count >= 1 && contextIntegrity.valid);
    const contextEvidence = await tx.select().from(aiceoContextEvidenceEventsTable)
      .where(eq(aiceoContextEvidenceEventsTable.projectId, project.id));
    assert.ok(contextEvidence.some((event) =>
      event.source === "work"
      && event.claimedPhase === "Architecture Phase"
      && event.claimedTask === "Grok Agent Integration Contract"
      && event.claimedNextStep === "next Grok Agent Integration Contract"
      && event.disposition === "context_drift_rejected"
      && !event.stateOverrideAccepted
      && !event.productionAuthority));
    const selfCheckContracts = await tx.select().from(aiceoSelfCheckChainContractsTable);
    assert.deepEqual(selfCheckContracts, [{
      chainKey: "g1-memory", contractVersion: "G1-001-SC-1",
      requiredModuleKeys: ["memory-candidate", "memory-event", "thought-node"],
      active: true, productionAuthority: false,
    }]);
    const quarantine = await tx.execute(sql`select count(*)::int as value from aiceo_memory_rejected_event_quarantine`);
    assert.equal(Number((quarantine.rows[0] as { value: number }).value), 2);
    const removedFunctions = await tx.execute(sql`
      select to_regprocedure('aiceo_promote_memory(uuid,uuid,text,text)') as promote,
             to_regprocedure('aiceo_append_memory_event(uuid,uuid,uuid,text,text,text,jsonb)') as append
    `);
    assert.equal((removedFunctions.rows[0] as any).promote, null);
    assert.equal((removedFunctions.rows[0] as any).append, null);

    const memoryRule = state.decisionRuleRegistry.find((rule: any) => rule.id === MEMORY_FOUNDATION_RULE.id);
    assert.deepEqual(canonical(memoryRule), canonical(MEMORY_FOUNDATION_RULE));
    const selfCheckRule = state.decisionRuleRegistry.find((rule: any) => rule.id === LAYERED_SELF_CHECK_RULE.id);
    assert.deepEqual(canonical(selfCheckRule), canonical(LAYERED_SELF_CHECK_RULE));
    const inboxRule = state.decisionRuleRegistry.find((rule: any) => rule.id === PRECLASSIFICATION_MEMORY_INBOX_RULE.id);
    assert.deepEqual(canonical(inboxRule), canonical(PRECLASSIFICATION_MEMORY_INBOX_RULE));
    const contextRule = state.decisionRuleRegistry.find((rule: any) => rule.id === CONTEXT_AUTHORITY_CONTINUITY_RULE.id);
    assert.deepEqual(canonical(contextRule), canonical(CONTEXT_AUTHORITY_CONTINUITY_RULE));
    const memoryEntity = state.entityRegistry.find((entity: any) => entity.id === "memory-g1-001");
    assert.deepEqual(memoryEntity, {
      id: "memory-g1-001", type: "memory_operating_system_foundation",
      status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED",
      version: "G1-001", productionAuthority: false,
    });
    const acceptance = state.evidencePointers.find((pointer: any) =>
      pointer.id === "g1-001-context-authority-generated-contract-reacceptance");
    assert.equal(acceptance?.result, "VERIFIED");

    const continuityEvents = await tx.select().from(aiceoContinuityEventsTable)
      .where(eq(aiceoContinuityEventsTable.projectId, project.id))
      .orderBy(asc(aiceoContinuityEventsTable.appendSequence));
    let previous: string | null = null;
    for (const [index, event] of continuityEvents.entries()) {
      assert.equal(Number(event.appendSequence), index + 1, "Fail-Closed: Continuity sequence gap");
      assert.equal(event.previousHash, previous, "Fail-Closed: Continuity evidence chain broken");
      const expected = createHmac("sha256", secret).update(JSON.stringify(canonical({
        id: event.id, projectId: event.projectId, state: event.state, actorId: event.actorId,
        eventType: event.eventType, payload: event.payload, previousHash: event.previousHash,
        serverTimestamp: event.serverTimestamp,
      }))).digest("hex");
      assert.equal(event.eventHash, expected, "Fail-Closed: Continuity HMAC invalid");
      previous = event.eventHash;
    }

    const intentConfirmations = await tx.select().from(aiceoIntentConfirmationsTable)
      .where(eq(aiceoIntentConfirmationsTable.projectId, project.id))
      .orderBy(asc(aiceoIntentConfirmationsTable.createdAt), asc(aiceoIntentConfirmationsTable.id));
    assert.ok(intentConfirmations.every((item: any) => item.status === "CONFIRMED" && !item.productionAuthority));

    const targetCurrentState = {
      ...state.currentState,
      verification: "VERIFIED",
      closure: "CLOSED",
      closureIntegrityAudit: "VERIFIED",
      closureIntegrityAuditedRevision: AUDITED_REVISION,
    };
    const targetEntities = state.entityRegistry.map((entity: any) => {
      if (entity.id === "continuity-001") {
        return { id: "continuity-001", type: "implementation", status: "COMPLETED", verification: "VERIFIED", closure: "CLOSED" };
      }
      if (entity.id === "memory-g1-001") {
        return { ...entity, status: "COMPLETED", verification: "VERIFIED", closure: "CLOSED" };
      }
      return entity;
    });
    const targetResumeNode = {
      node: "g1-002-memory-retrieval-router",
      action: "G1-001 is closed. The next item is Retrieval Router design and implementation; do not start it automatically.",
      status: "CLOSED",
      ownerGate: false,
      closureIntegrityAudit: "VERIFIED",
    };
    const recoveryStrategy = "Read PostgreSQL Persistent State, verify the latest signed Closure Integrity Audit and HMAC chain, then stop at the CLOSED Resume Node until the Owner starts the next item.";
    const report = {
      auditedRevision: AUDITED_REVISION,
      generatedBy: "aiceo:g1-001-closure-integrity-auditor",
      allPassed: true,
      intentConfirmationsHash: digest(intentConfirmations),
      closureIntentHash: closureIntentDigest({
        auditedRevision: AUDITED_REVISION,
        state: "COMPLETED",
        currentState: targetCurrentState,
        decisionRuleRegistry: state.decisionRuleRegistry,
        entityRegistry: targetEntities,
        aliasDictionary: state.aliasDictionary,
        historicalEvidence: state.evidencePointers,
        resumeNode: targetResumeNode,
        failureReason: null,
        recoveryStrategy,
        ownerGateReason: null,
      }),
      commands,
    };
    const auditEvidence = {
      id: "g1-001-closure-integrity-audit",
      type: "closure_integrity_audit",
      auditedRevision: AUDITED_REVISION,
      result: "VERIFIED",
      checks: {
        memoryContract: true, thoughtContinuityCore: true, candidateWriteGates: true, projectIsolation: true,
        provenanceAndTemporalValidity: true, immutableLifecycle: true,
        monotonicConcurrentEventChain: true, monotonicConcurrentThoughtGraph: true,
        evidenceBoundCausalBacktrace: true, outcomeCounterfactualSupersedeControls: true,
        layeredLocalChainGlobalSelfChecks: true, progressiveDiagnosticEscalation: true,
        summaryFirstGlobalIntegrity: true, selfCheckNotIndependentValidation: true,
        sealedPreclassificationInbox: true, exactEightOwnerThemes: true,
        inboxOriginProvenanceIntegrity: true, futureScientificMigrationDeferredAndBlocked: true,
        externalContextCandidateOnly: true, persistentStateCompleteIntentVerified: true,
        contextDriftRecordedAndRejected: true, staleArchitecturePhaseRollbackRejected: true,
        crossIngressResumeWithoutOwnerRestatement: true, contextEvidenceIntegrity: true,
        officialOpenapiCodegen: true, generatedReactAndZodContracts: true,
        persistentState: true, continuityHmac: true,
        ownerSovereignty: true, ownerProtectionTriad: true, intentGate: true,
        foundationsFrozen: true, queueAndSafetyControls: true, deferredModules: true,
        legacyRegression: true,
      },
      regressionReport: report,
      regressionReportHmac: createHmac("sha256", secret)
        .update(JSON.stringify(canonical(report))).digest("hex"),
      memoryCounts,
      contextIntegrity,
      quarantinedInvalidTestEvents: 2,
      continuityEventsVerified: continuityEvents.length,
      authorityUnchanged: true,
      grantsAuthority: false,
      productionAuthority: false,
    };
    return layer.update({
      state: "COMPLETED",
      currentState: targetCurrentState,
      decisionRuleRegistry: state.decisionRuleRegistry,
      entityRegistry: targetEntities,
      aliasDictionary: state.aliasDictionary,
      evidencePointers: [...state.evidencePointers, auditEvidence],
      resumeNode: targetResumeNode,
      failureReason: null,
      recoveryStrategy,
      ownerGateReason: null,
    }, "aiceo:g1-001-closure-integrity-auditor");
  });
  assert.equal(result.revision, 45);
  assert.equal(result.productionAuthority, false);
  console.log(JSON.stringify({
    revision: result.revision, verification: "VERIFIED", closure: "CLOSED",
    closureIntegrityAudit: "VERIFIED", auditedRevision: AUDITED_REVISION,
    resumeNode: "g1-002-memory-retrieval-router", autoStarted: false,
    productionAuthority: false, eventHash: result.eventHash,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});