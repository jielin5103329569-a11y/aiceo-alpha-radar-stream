import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { count, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiceoContinuityProjectsTable, aiceoContinuityStateTable,
  aiceoMemoryCandidatesTable, aiceoMemoryEventsTable, aiceoPromotedMemoriesTable,
  aiceoThoughtNodesTable,
  aiceoSelfCheckReportsTable, aiceoSelfCheckChainContractsTable,
  aiceoPreclassificationMemoryInboxTable, aiceoPreclassificationSeedManifestTable,
  aiceoContextEvidenceEventsTable,
} from "@workspace/db/schema";
import {
  AiceoContinuityLayer, LAYERED_SELF_CHECK_RULE, MEMORY_FOUNDATION_RULE,
  PRECLASSIFICATION_MEMORY_INBOX_RULE, CONTEXT_AUTHORITY_CONTINUITY_RULE,
} from "../artifacts/api-server/src/lib/aiceoContinuityLayer";
import { aiceoPreclassificationInbox } from "../artifacts/api-server/src/lib/aiceoPreclassificationInbox";

async function main() {
  const result = await db.transaction(async (tx) => {
    const project = (await tx.select().from(aiceoContinuityProjectsTable)
      .where(eq(aiceoContinuityProjectsTable.projectKey, "aiceo")).for("update"))[0];
    const state = project && (await tx.select().from(aiceoContinuityStateTable)
      .where(eq(aiceoContinuityStateTable.projectId, project.id)).for("update"))[0];
    assert.ok(project && state, "Fail-Closed: AICEO Persistent State is missing");
    assert.equal(state.revision, 43, "Fail-Closed: G1-001 generated contract re-acceptance revision drift");
    assert.equal(state.currentState.verification, "NOT_VERIFIED");
    assert.equal(state.currentState.closure, "BLOCKED");
    assert.equal(project.productionAuthority, false);

    const activeCounts = {
      candidates: Number((await tx.select({ value: count() }).from(aiceoMemoryCandidatesTable))[0].value),
      promoted: Number((await tx.select({ value: count() }).from(aiceoPromotedMemoriesTable))[0].value),
      events: Number((await tx.select({ value: count() }).from(aiceoMemoryEventsTable))[0].value),
      thoughts: Number((await tx.select({ value: count() }).from(aiceoThoughtNodesTable))[0].value),
      selfChecks: Number((await tx.select({ value: count() }).from(aiceoSelfCheckReportsTable))[0].value),
      preclassificationInbox: Number((await tx.select({ value: count() }).from(aiceoPreclassificationMemoryInboxTable))[0].value),
    };
    assert.deepEqual(activeCounts, { candidates: 0, promoted: 0, events: 0, thoughts: 0, selfChecks: 0, preclassificationInbox: 8 });
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
      && event.conflictFields.includes("phase")
      && event.conflictFields.includes("task")
      && event.conflictFields.includes("next_step")
      && !event.stateOverrideAccepted
      && !event.productionAuthority));
    const generatedZod = readFileSync("lib/api-zod/src/generated/api.ts", "utf8");
    const generatedTypes = readFileSync("lib/api-zod/src/generated/types/aiceoContinuityResumeInput.ts", "utf8");
    assert.doesNotMatch(generatedZod, /zod\.int\(/);
    assert.match(generatedZod, /claimedRevision.*number\(\).*multipleOf\([^)]*ClaimedRevisionMultipleOf\)/s);
    assert.match(generatedZod, /ClaimedRevisionMultipleOf = 1/);
    assert.match(generatedTypes, /externalContext/);
    const contracts = await tx.select().from(aiceoSelfCheckChainContractsTable);
    assert.deepEqual(contracts, [{
      chainKey: "g1-memory", contractVersion: "G1-001-SC-1",
      requiredModuleKeys: ["memory-candidate", "memory-event", "thought-node"],
      active: true, productionAuthority: false,
    }]);
    const quarantine = await tx.execute(sql`select count(*)::int as value from aiceo_memory_rejected_event_quarantine`);
    assert.equal(Number((quarantine.rows[0] as { value: number }).value), 2);

    const rules = state.decisionRuleRegistry
      .filter((rule: any) => ![
        MEMORY_FOUNDATION_RULE.id, LAYERED_SELF_CHECK_RULE.id, PRECLASSIFICATION_MEMORY_INBOX_RULE.id,
        CONTEXT_AUTHORITY_CONTINUITY_RULE.id,
      ].includes(rule.id))
      .concat([
        MEMORY_FOUNDATION_RULE, LAYERED_SELF_CHECK_RULE, PRECLASSIFICATION_MEMORY_INBOX_RULE,
        CONTEXT_AUTHORITY_CONTINUITY_RULE,
      ]);
    const entities = state.entityRegistry.map((entity: any) => {
      if (entity.id === "continuity-001") {
        return { id: "continuity-001", type: "implementation", status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED" };
      }
      if (entity.id === "memory-g1-001") {
        return { ...entity, status: "COMPLETED", verification: "NOT_VERIFIED", closure: "BLOCKED" };
      }
      return entity;
    });
    return layer.update({
      state: "COMPLETED",
      currentState: {
        ...state.currentState,
        completedTask: "G1-001 — Memory OS with Context Authority, Context Drift rejection, and cross-ingress recovery",
        verification: "NOT_VERIFIED",
        closure: "BLOCKED",
        acceptedRevision: 43,
        closureIntegrityAudit: "NOT_VERIFIED",
      },
      decisionRuleRegistry: rules,
      entityRegistry: entities,
      aliasDictionary: state.aliasDictionary,
      evidencePointers: [...state.evidencePointers, {
        id: "g1-001-context-authority-generated-contract-reacceptance",
        type: "independent_read_only_acceptance",
        reviewedScope: "g1_001_context_authority_generated_api_contract_reconciliation",
        result: "VERIFIED",
        checks: [
          "schema_and_database_constraints", "candidate_permissions", "project_isolation",
          "provenance_and_temporal_validity", "immutable_lifecycle", "monotonic_event_chain",
          "transaction_start_inversion", "deferred_capabilities", "zero_active_memory_residue",
          "causal_decision_backtrace", "counterfactual_integrity", "outcome_action_ancestry",
          "reality_correction_and_single_superseder", "citation_does_not_upgrade_truth",
          "exact_local_dimensions", "migration_owned_chain_completeness",
          "fresh_child_hash_aggregation", "fault_domain_localization",
          "summary_first_global_integrity", "progressive_deep_escalation",
          "self_check_is_not_independent_validation",
          "eight_exact_raw_high_value_themes", "sealed_seed_manifest",
          "source_context_time_and_origin_hash_chain", "concurrent_idempotent_replay",
          "non_operational_non_retrieval_non_promotion_non_governance",
          "future_scientific_migration_blocked_with_origin_lineage_requirements",
          "external_ingress_candidate_context_only", "persistent_state_complete_intent_hmac",
          "context_drift_append_only_evidence", "stale_architecture_phase_rejected",
          "bro_and_aiceo_continue_cross_chat_recovery", "all_ingress_classes_concurrent",
          "project_local_continuity_sequence", "memory_explains_why_without_state_override",
          "official_openapi_codegen", "generated_react_and_zod_contracts",
          "positive_integer_revision_semantics", "workspace_library_typecheck",
        ],
        activeCounts,
        contextIntegrity,
        quarantinedInvalidTestEvents: 2,
        grantsAuthority: false,
        productionAuthority: false,
      }],
      resumeNode: {
        node: "g1-001-context-authority-closure-integrity-audit",
        action: "Run the signed G1-001 Context Authority and Context Drift Closure Integrity Audit; do not start G1-002.",
        status: "BLOCKED",
        ownerGate: false,
      },
      failureReason: "G1-001 Context Authority contract passed independent acceptance but remains blocked until the full signed Closure Integrity Audit succeeds.",
      recoveryStrategy: "Run all G1-001 and legacy governance regressions, verify Persistent State intent/HMAC, context evidence chains, and stale-context rejection, then close only this implementation.",
      ownerGateReason: null,
    }, "aiceo:g1-001-independent-acceptance");
  });
  assert.equal(result.revision, 44);
  console.log(JSON.stringify({
    revision: result.revision,
    verification: "NOT_VERIFIED",
    closure: "BLOCKED",
    resumeNode: "g1-001-context-authority-closure-integrity-audit",
    productionAuthority: false,
    eventHash: result.eventHash,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});