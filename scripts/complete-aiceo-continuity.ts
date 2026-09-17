import { aiceoContinuityLayer } from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

async function main() {
  const snapshot = await aiceoContinuityLayer.snapshot("aiceo_operator");
  const state = snapshot.state;
  const hasImprovementLoop = state.decisionRuleRegistry.some((rule) => rule.id === "continuous-collaboration-improvement-loop");
  const hasIntegrationEvidence = state.evidencePointers.some(
    (pointer) => pointer.pointer === "scripts/test-aiceo-collaboration-loop-integration.ts",
  );
  const hasAgentProtocolEvidence = state.evidencePointers.some(
    (pointer) => pointer.pointer === "scripts/test-aiceo-agent-protocol-integration.ts",
  );
  if (state.state !== "COMPLETED" || !hasImprovementLoop || !hasIntegrationEvidence || !hasAgentProtocolEvidence) {
  const entities = state.entityRegistry.map((entity) =>
    entity.id === "continuity-001"
      ? { ...entity, status: "COMPLETED", verification: "PENDING_INDEPENDENT_READ_ONLY_ACCEPTANCE" }
      : entity,
  );
  if (!entities.some((entity) => entity.id === "collaboration-loop-001")) {
    entities.push({ id: "collaboration-loop-001", type: "continuous_improvement_loop", status: "ACTIVE", version: "COLLABORATION-LOOP-001" });
  }
  if (!entities.some((entity) => entity.id === "brain-agent-001")) {
    entities.push({ id: "brain-agent-001", type: "execution_protocol", status: "ACTIVE", version: "BRAIN-AGENT-001" });
  }
  const rules = hasImprovementLoop ? state.decisionRuleRegistry : [
    ...state.decisionRuleRegistry,
    {
      id: "continuous-collaboration-improvement-loop",
      version: 1,
      rule: "Capture evidence-backed collaboration friction, classify root cause, define correct behavior, conflict-check, version ordinary improvements, validate actual improvement, and roll back safely. Owner Protection or authority changes fail closed at OWNER_GATE.",
      scope: "Owner–Brain collaboration",
    },
  ];
  if (!rules.some((rule) => rule.id === "brain-agent-execution-protocol")) {
    rules.push({
      id: "brain-agent-execution-protocol",
      version: 1,
      rule: "Only the Brain resolves Owner intent and issues immutable machine contracts. Agents cannot expand authority, drift scope, reuse stale context, expose secrets, or self-verify; questions escalate to Brain and only true Owner Gates reach Owner.",
      scope: "All current and future delegated agents",
    });
  }
  const result = await aiceoContinuityLayer.update({
    state: "COMPLETED",
    currentState: {
      ...state.currentState,
      implementation: "COMPLETED",
      verification: "PENDING_INDEPENDENT_READ_ONLY_ACCEPTANCE",
    },
    decisionRuleRegistry: rules,
    entityRegistry: entities,
    aliasDictionary: state.aliasDictionary,
    evidencePointers: [
      ...state.evidencePointers,
      ...(!hasIntegrationEvidence ? [{
        type: "transactional_integration_test",
        pointer: "scripts/test-aiceo-collaboration-loop-integration.ts",
        isolation: "automatic_rollback",
        paths: ["ordinary_rule_lifecycle", "owner_protection_fail_closed"],
      }] : []),
      ...(!hasAgentProtocolEvidence ? [{
        type: "transactional_integration_test",
        pointer: "scripts/test-aiceo-agent-protocol-integration.ts",
        isolation: "automatic_rollback",
        paths: ["contract_idempotency", "stale_rejection", "scope_drift", "independent_verification"],
      }, {
        type: "migration",
        pointer: "lib/db/drizzle/0018_aiceo_brain_agent_protocol.sql",
      }] : []),
    ],
    resumeNode: {
      node: "independent-read-only-acceptance",
      action: "Verify persistent state, HMAC chain, restart recovery, safety invariants and API contract",
      ownerGate: false,
    },
    failureReason: null,
    recoveryStrategy: "Read PostgreSQL continuity state and continue from resumeNode; never reconstruct truth from chat memory.",
    ownerGateReason: null,
  }, "aiceo:continuity-supervisor");
    console.log(JSON.stringify({ state: result.state, revision: result.revision, productionAuthority: result.productionAuthority }));
  } else {
    console.log(JSON.stringify({ state: state.state, revision: state.revision, productionAuthority: false }));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});