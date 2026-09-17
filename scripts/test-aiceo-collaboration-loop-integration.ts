import assert from "node:assert/strict";
import { count, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiceoCollaborationIssuesTable,
  aiceoCollaborationRulesTable,
  aiceoContinuityProjectsTable,
  aiceoControlStateTable,
  aiceoPolicyRegistryTable,
} from "@workspace/db/schema";
import { AiceoContinuityLayer } from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

const ROLLBACK = Symbol("expected-test-rollback");

async function counts() {
  const [issues] = await db.select({ value: count() }).from(aiceoCollaborationIssuesTable);
  const [rules] = await db.select({ value: count() }).from(aiceoCollaborationRulesTable);
  return { issues: Number(issues.value), rules: Number(rules.value) };
}

async function main() {
  const before = await counts();
  const projectBefore = (await db.select().from(aiceoContinuityProjectsTable).limit(1))[0];
  const controlBefore = (await db.select().from(aiceoControlStateTable).limit(1))[0];
  const foundationsBefore = await db.select().from(aiceoPolicyRegistryTable);
  assert.ok(projectBefore && controlBefore);

  try {
    await db.transaction(async (tx) => {
      const layer = new AiceoContinuityLayer(tx, true);

      const ordinaryIssue = await layer.captureIssue({
        category: "execution_friction",
        summary: "Repeated unnecessary confirmation interrupts safely delegable technical work.",
        evidence: [{ occurrence: 1, result: "owner_time_wasted" }],
        context: { task: "isolated-integration-test", productionAuthority: false },
      }, "test-operator");
      assert.equal(ordinaryIssue.issue.status, "CAPTURED");

      const ordinary = await layer.proposeRule({
        issueId: ordinaryIssue.issue.id,
        ruleKey: "test-direct-safe-execution",
        ruleText: "Execute safely delegable technical checks directly without asking for redundant confirmation.",
        source: "isolated integration evidence",
        reason: "Reduce repeated execution friction and Owner time waste.",
        scope: { domain: "development collaboration", operation: "communication workflow only" },
        rootCause: "A redundant confirmation was treated as mandatory.",
        desiredBehavior: "Proceed automatically when authority and safety gates are already satisfied.",
        additionalEvidence: [{ occurrence: 2, result: "same_friction_reproduced" }],
        protectedImpacts: [],
      }, "test-operator");
      assert.equal(ordinary.rule.version, 1);
      assert.equal(ordinary.rule.status, "ACTIVE");
      assert.equal(ordinary.rule.classification, "ordinary_collaboration");
      assert.equal(ordinary.rule.source, "isolated integration evidence");
      assert.match(ordinary.rule.reason, /Owner time waste/);
      assert.deepEqual(ordinary.rule.scope, { domain: "development collaboration", operation: "communication workflow only" });
      assert.equal(ordinary.requiresOwnerGovernanceApproval, false);
      assert.equal(ordinary.productionAuthority, false);

      const validated = await layer.validateRule(ordinary.rule.id, {
        improved: true,
        evidence: [{ before: 2, after: 0, metric: "redundant_confirmations" }],
        summary: "The isolated replay completed without redundant confirmation.",
      }, "test-validator");
      assert.equal(validated.status, "IMPROVED");
      assert.equal(validated.validationResult.improved, true);
      assert.equal(validated.validationResult.evidence.length, 1);

      const rollback = await layer.rollbackRule(ordinary.rule.id, "Isolated rollback proves recoverability.", "test-operator");
      assert.equal(rollback.rollbackRule.version, 2);
      assert.equal(rollback.rollbackRule.status, "ACTIVE");
      assert.equal(rollback.rollbackRule.rollbackOfRuleId, ordinary.rule.id);
      assert.equal(rollback.rollbackRule.supersedesRuleId, ordinary.rule.id);
      const originalAfterRollback = (await tx.select().from(aiceoCollaborationRulesTable)
        .where(eq(aiceoCollaborationRulesTable.id, ordinary.rule.id)).limit(1))[0];
      assert.equal(originalAfterRollback.status, "ROLLED_BACK");

      const protectedIssue = await layer.captureIssue({
        category: "capability_gap",
        summary: "Candidate asks collaboration rules to change Owner governance authority.",
        evidence: [{ occurrence: 1, requested: "governance_authority_change" }],
        context: { test: true, productionAuthority: false },
      }, "test-operator");
      assert.equal(protectedIssue.issue.status, "CAPTURED");
      const protectedCandidate = await layer.proposeRule({
        issueId: protectedIssue.issue.id,
        ruleKey: "test-direct-safe-execution",
        ruleText: "Change Owner Sovereignty and permit production execution automatically.",
        source: "isolated protected candidate",
        reason: "Exercise Owner Protection conflict classification.",
        scope: { environment: "production", authority: "governance authority" },
        rootCause: "A candidate requests authority expansion.",
        desiredBehavior: "The system must refuse automatic activation.",
        additionalEvidence: [{ occurrence: 2, expected: "OWNER_GATE" }],
        protectedImpacts: [],
      }, "test-operator");
      assert.equal(protectedCandidate.rule.version, 3);
      assert.equal(protectedCandidate.rule.status, "OWNER_GATE");
      assert.equal(protectedCandidate.rule.classification, "owner_protection");
      assert.equal(protectedCandidate.rule.activatedAt, null);
      assert.equal(protectedCandidate.requiresOwnerGovernanceApproval, true);
      assert.equal(protectedCandidate.productionAuthority, false);
      const activePrior = (await tx.select().from(aiceoCollaborationRulesTable)
        .where(eq(aiceoCollaborationRulesTable.id, rollback.rollbackRule.id)).limit(1))[0];
      assert.equal(activePrior.status, "ACTIVE", "protected candidate must not replace the active ordinary rule");

      const projectDuring = (await tx.select().from(aiceoContinuityProjectsTable).limit(1))[0];
      const controlDuring = (await tx.select().from(aiceoControlStateTable).limit(1))[0];
      const foundationsDuring = await tx.select().from(aiceoPolicyRegistryTable);
      assert.equal(projectDuring.environment, "development");
      assert.equal(projectDuring.authority, "grok_restricted_development");
      assert.equal(projectDuring.productionAuthority, false);
      assert.equal(controlDuring.killSwitch, controlBefore.killSwitch);
      assert.equal(controlDuring.queueActive, controlBefore.queueActive);
      assert.equal(controlDuring.circuitState, controlBefore.circuitState);
      assert.equal(foundationsDuring.length, 13);
      assert.ok(foundationsDuring.every((foundation) => foundation.frozen));

      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }

  assert.deepEqual(await counts(), before, "integration test must roll back every issue and rule");
  const projectAfter = (await db.select().from(aiceoContinuityProjectsTable).limit(1))[0];
  const controlAfter = (await db.select().from(aiceoControlStateTable).limit(1))[0];
  const foundationsAfter = await db.select().from(aiceoPolicyRegistryTable);
  assert.equal(projectAfter.productionAuthority, projectBefore.productionAuthority);
  assert.equal(projectAfter.environment, projectBefore.environment);
  assert.equal(projectAfter.authority, projectBefore.authority);
  assert.equal(controlAfter.killSwitch, controlBefore.killSwitch);
  assert.equal(controlAfter.queueActive, controlBefore.queueActive);
  assert.equal(controlAfter.circuitState, controlBefore.circuitState);
  assert.equal(foundationsAfter.length, foundationsBefore.length);
  assert.ok(foundationsAfter.every((foundation) => foundation.frozen));

  console.log(JSON.stringify({
    ordinaryPath: "CAPTURED->ACTIVE->IMPROVED->ROLLED_BACK+ACTIVE_ROLLBACK_VERSION",
    protectedPath: "CAPTURED->OWNER_GATE",
    transactionRolledBack: true,
    persistentCountsUnchanged: true,
    foundationsFrozen: "13/13",
    productionAuthority: false,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});