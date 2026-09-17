import { aiceoContinuityLayer } from "../artifacts/api-server/src/lib/aiceoContinuityLayer";

async function main() {
  const snapshot = await aiceoContinuityLayer.snapshot("aiceo_operator");
  const state = snapshot.state;
  if (state.state !== "COMPLETED") {
  const entities = state.entityRegistry.map((entity) =>
    entity.id === "continuity-001"
      ? { ...entity, status: "COMPLETED", verification: "PENDING_INDEPENDENT_READ_ONLY_ACCEPTANCE" }
      : entity,
  );
  const result = await aiceoContinuityLayer.update({
    state: "COMPLETED",
    currentState: {
      ...state.currentState,
      implementation: "COMPLETED",
      verification: "PENDING_INDEPENDENT_READ_ONLY_ACCEPTANCE",
    },
    decisionRuleRegistry: state.decisionRuleRegistry,
    entityRegistry: entities,
    aliasDictionary: state.aliasDictionary,
    evidencePointers: [
      ...state.evidencePointers,
      { type: "test", pointer: "scripts/test-aiceo-continuity-layer.mjs" },
      { type: "api_contract", pointer: "lib/api-spec/openapi.yaml" },
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