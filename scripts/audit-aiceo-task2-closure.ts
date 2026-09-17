import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
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
  aiceoIntentConfirmationsTable,
  aiceoPolicyRegistryTable,
  aiceoTasksTable,
} from "@workspace/db/schema";
import { AiceoContinuityLayer, closureIntentDigest } from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

const AUDITED_REVISION = 26;
const REQUIRED_DENIES = ["Production", "trading", "Databento", "Alert"];
const REQUIRED_RED_LINES = [
  "financial_and_physical_assets",
  "legal_liability",
  "aiceo_system_integrity",
];

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

const tableCount = async (tx: any, table: any) =>
  Number((await tx.select({ value: count() }).from(table))[0].value);

async function main() {
  const secret = process.env.SESSION_SECRET;
  assert.ok(secret && secret.length >= 32, "Fail-Closed: signing authority is unavailable");
  const regressionCommands = [
    { name: "api-server:typecheck", args: ["--filter", "@workspace/api-server", "run", "typecheck"] },
    { name: "test:aiceo-control-plane", args: ["run", "test:aiceo-control-plane"] },
    { name: "test:aiceo-permission-matrix", args: ["run", "test:aiceo-permission-matrix"] },
    { name: "test:aiceo-governance-root", args: ["run", "test:aiceo-governance-root"] },
    { name: "test:aiceo-continuity-layer", args: ["run", "test:aiceo-continuity-layer"] },
    { name: "test:aiceo-agent-protocol", args: ["run", "test:aiceo-agent-protocol"] },
    { name: "test:aiceo-collaboration-loop-integration", args: ["run", "test:aiceo-collaboration-loop-integration"] },
    { name: "test:aiceo-agent-protocol-integration", args: ["run", "test:aiceo-agent-protocol-integration"] },
    { name: "test:aiceo-closure-integrity", args: ["run", "test:aiceo-closure-integrity"] },
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

    assert.equal(state.revision, AUDITED_REVISION, "Fail-Closed: closure audit revision drift");
    assert.equal(state.state, "COMPLETED", "Fail-Closed: Task 2 is not completed");
    assert.equal(state.currentState.verification, "NOT_VERIFIED", "Fail-Closed: remediation verification state drift");
    assert.equal(state.currentState.closure, "BLOCKED", "Fail-Closed: remediation closure state drift");
    assert.equal(state.currentState.acceptedRevision, 6, "Fail-Closed: final acceptance is not bound to revision 6");
    assert.equal(state.resumeNode.node, "intent-uncertainty-confirmation-gate-acceptance", "Fail-Closed: intent-gate acceptance Resume Node drift");
    assert.equal(state.resumeNode.status, "BLOCKED", "Fail-Closed: remediation Resume Node state drift");
    assert.equal(state.resumeNode.ownerGate, false, "Fail-Closed: unexpected Owner Gate");
    assert.match(
      state.failureReason ?? "",
      /implemented and persisted.*pending full signed re-acceptance/i,
      "Fail-Closed: remediation blocker missing",
    );
    assert.equal(state.ownerGateReason, null, "Fail-Closed: unresolved Owner Gate");

    assert.equal(project.environment, "development", "Fail-Closed: environment drift");
    assert.equal(project.authority, "grok_restricted_development", "Fail-Closed: authority drift");
    assert.equal(project.productionAuthority, false, "Fail-Closed: production authority drift");
    assert.equal(control.killSwitch, false, "Fail-Closed: Kill Switch active");
    assert.equal(control.queueActive, true, "Fail-Closed: Queue inactive");
    assert.equal(control.circuitState, "CLOSED", "Fail-Closed: Circuit Breaker not CLOSED");
    assert.equal(control.circuitFailureCount, 0, "Fail-Closed: Circuit failure count drift");

    const foundations = await tx.select().from(aiceoPolicyRegistryTable);
    assert.equal(foundations.length, 13, "Fail-Closed: Foundation count drift");
    assert.ok(foundations.every((foundation: any) => foundation.frozen), "Fail-Closed: frozen Foundation changed");

    const authorityRule = state.decisionRuleRegistry.find((rule: any) => rule.id === "authority-boundary");
    const ownerGateRule = state.decisionRuleRegistry.find((rule: any) => rule.id === "owner-only-gates");
    const agentRule = state.decisionRuleRegistry.find((rule: any) => rule.id === "brain-agent-execution-protocol");
    const collaborationRule = state.decisionRuleRegistry.find((rule: any) => rule.id === "continuous-collaboration-improvement-loop");
    assert.ok(authorityRule && ownerGateRule && agentRule && collaborationRule, "Fail-Closed: governing dependency chain is incomplete");
    const authorityText = JSON.stringify(authorityRule);
    for (const deny of REQUIRED_DENIES) assert.match(authorityText, new RegExp(deny, "i"), `Fail-Closed: ${deny} deny missing`);
    assert.match(JSON.stringify(ownerGateRule), /Owner|identity|credentials|red lines/i);
    assert.match(JSON.stringify(agentRule), /immutable|authority|scope|stale|self-verify/i);
    assert.match(JSON.stringify(collaborationRule), /conflict-check|Owner Protection|OWNER_GATE/i);

    const owner = state.entityRegistry.find((entity: any) => entity.id === "owner");
    const brain = state.entityRegistry.find((entity: any) => entity.id === "brain");
    const agent = state.entityRegistry.find((entity: any) => entity.id === "agent");
    assert.equal(owner?.authority, "ultimate_human_governance_authority", "Fail-Closed: Owner Sovereignty drift");
    assert.match(brain?.authority ?? "", /maximum_technical_sovereignty_below_owner_red_lines/);
    assert.equal(agent?.authority, "delegated_technical_authority", "Fail-Closed: Agent authority drift");
    assert.equal(state.aliasDictionary.Bro, "aiceo_brain_exclusive_alias", "Fail-Closed: exclusive Brain Alias drift");

    const evidenceIds = new Set(state.evidencePointers.map((pointer: any) => pointer.id));
    const evidencePaths = new Set(state.evidencePointers.map((pointer: any) => pointer.pointer));
    assert.ok(evidenceIds.has("task-2-final-independent-read-only-acceptance"), "Fail-Closed: final acceptance evidence missing");
    assert.ok(evidenceIds.has("brain-agent-negative-gates-v2"), "Fail-Closed: Agent negative-gate evidence missing");
    assert.ok(evidencePaths.has("scripts/test-aiceo-collaboration-loop-integration.ts"), "Fail-Closed: Collaboration Loop evidence missing");
    assert.ok(evidencePaths.has("lib/db/drizzle/0018_aiceo_brain_agent_protocol.sql"), "Fail-Closed: Contract migration evidence missing");

    const events = await tx.select().from(aiceoContinuityEventsTable)
      .where(eq(aiceoContinuityEventsTable.projectId, project.id))
      .orderBy(asc(aiceoContinuityEventsTable.serverTimestamp), asc(aiceoContinuityEventsTable.id));
    assert.equal(events.length, 25, "Fail-Closed: expected revision-26 evidence count changed");
    let previous: string | null = null;
    for (const event of events) {
      assert.equal(event.previousHash, previous, "Fail-Closed: Evidence chain broken");
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
      assert.equal(event.eventHash, expected, "Fail-Closed: Evidence HMAC invalid");
      previous = event.eventHash;
    }

    const persistentCounts = {
      contracts: await tableCount(tx, aiceoExecutionContractsTable),
      runs: await tableCount(tx, aiceoAgentRunsTable),
      verifications: await tableCount(tx, aiceoAgentVerificationsTable),
      issues: await tableCount(tx, aiceoCollaborationIssuesTable),
      rules: await tableCount(tx, aiceoCollaborationRulesTable),
      intentConfirmations: await tableCount(tx, aiceoIntentConfirmationsTable),
    };
    assert.deepEqual(persistentCounts, { contracts: 0, runs: 0, verifications: 0, issues: 0, rules: 0, intentConfirmations: 0 });
    const activeTasks = Number((await tx.select({ value: count() }).from(aiceoTasksTable)
      .where(inArray(aiceoTasksTable.state, ["RUNNING", "VALIDATING"])))[0].value);
    assert.equal(activeTasks, 0, "Fail-Closed: Queue has active work");

    const closureRule = state.decisionRuleRegistry.find((rule: any) => rule.id === "closure-integrity-audit");
    const intentGateRule = state.decisionRuleRegistry.find((rule: any) => rule.id === "intent-uncertainty-confirmation-gate");
    const intentGateEntity = state.entityRegistry.find((entity: any) => entity.id === "intent-gate-001");
    assert.ok(closureRule, "Fail-Closed: persistent Closure Integrity Audit rule missing");
    assert.match(JSON.stringify(intentGateRule), /two or more reasonable interpretations|Inference is not authorization|Agents escalate semantic ambiguity/i);
    assert.equal(intentGateRule?.confirmationIsAuthorization, false, "Fail-Closed: intent confirmation became authorization");
    assert.equal(intentGateRule?.ownerProtectionTriadUnaffected, true, "Fail-Closed: Owner Protection Triad gate was weakened");
    assert.deepEqual(intentGateEntity, { id: "intent-gate-001", type: "communication_understanding_gate", status: "ACTIVE", version: "INTENT-GATE-001", productionAuthority: false });
    const intentConfirmations = await tx.select().from(aiceoIntentConfirmationsTable)
      .where(eq(aiceoIntentConfirmationsTable.projectId, project.id))
      .orderBy(asc(aiceoIntentConfirmationsTable.createdAt), asc(aiceoIntentConfirmationsTable.id));
    assert.ok(intentConfirmations.every((confirmation: any) => confirmation.status === "CONFIRMED" && !confirmation.productionAuthority));
    const checks = {
      dependencyChain: true,
      governanceHierarchy: true,
      peerRuleConflicts: true,
      authorityChanges: true,
      persistentState: true,
      evidenceHmac: true,
      agentContractConstraints: true,
      safetyMechanisms: true,
      legacyRegression: true,
      queueResumeNode: true,
      foundations: true,
      ownerSovereignty: true,
      ownerProtectionTriad: true,
      intentUncertaintyConfirmationGate: true,
      brainAgentAmbiguityEscalation: true,
      confirmationIsNotAuthorization: true,
      failClosed: true,
      killSwitchCircuitBreaker: true,
    };
    const targetCurrentState = {
      ...state.currentState,
      verification: "VERIFIED",
      closure: "CLOSED",
      closureIntegrityAudit: "VERIFIED",
      closureIntegrityAuditedRevision: AUDITED_REVISION,
    };
    const targetEntities = state.entityRegistry.map((entity: any) =>
      entity.id === "continuity-001"
        ? { id: "continuity-001", type: "implementation", status: "COMPLETED", verification: "VERIFIED", closure: "CLOSED" }
        : entity);
    const targetResumeNode = {
      node: "task-2-closed",
      status: "CLOSED",
      action: "Task 2 is complete; verify the latest Closure Integrity Audit and await the Owner's next intent.",
      ownerGate: false,
      closureIntegrityAudit: "VERIFIED",
    };
    const targetRecoveryStrategy = "Read PostgreSQL continuity state, verify the latest Closure Integrity Audit evidence, signed closure intent and HMAC chain, then follow the CLOSED resumeNode without reconstructing truth from memory.";
    const regressionReport = {
      auditedRevision: AUDITED_REVISION,
      generatedBy: "aiceo:closure-integrity-auditor",
      allPassed: true,
      intentConfirmationsHash: createHash("sha256").update(JSON.stringify(canonical(intentConfirmations))).digest("hex"),
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
        recoveryStrategy: targetRecoveryStrategy,
        ownerGateReason: null,
      }),
      commands: regressionCommands,
    };
    const regressionReportHmac = createHmac("sha256", secret)
      .update(JSON.stringify(canonical(regressionReport)))
      .digest("hex");
    const evidencePointers = [
      ...state.evidencePointers,
      {
        id: "task-2-closure-integrity-audit-v1",
        type: "closure_integrity_audit",
        auditedRevision: AUDITED_REVISION,
        result: "VERIFIED",
        checks,
        regressionReport,
        regressionReportHmac,
        persistentCounts,
        hmacEventsVerified: events.length,
        grantsAuthority: false,
        productionAuthority: false,
      },
    ];

    const layer = new AiceoContinuityLayer(tx, true);
    return layer.update({
      state: "COMPLETED",
      currentState: targetCurrentState,
      decisionRuleRegistry: state.decisionRuleRegistry,
      entityRegistry: targetEntities,
      aliasDictionary: state.aliasDictionary,
      evidencePointers,
      resumeNode: targetResumeNode,
      failureReason: null,
      recoveryStrategy: targetRecoveryStrategy,
      ownerGateReason: null,
    }, "aiceo:closure-integrity-auditor");
  });

  assert.equal(result.revision, 27);
  assert.equal(result.productionAuthority, false);
  console.log(JSON.stringify({
    state: result.state,
    revision: result.revision,
    verification: "VERIFIED",
    closure: "CLOSED",
    closureIntegrityAudit: "VERIFIED",
    auditedRevision: AUDITED_REVISION,
    rule: "closure-integrity-audit",
    productionAuthority: false,
    evidenceEventHash: result.eventHash,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});