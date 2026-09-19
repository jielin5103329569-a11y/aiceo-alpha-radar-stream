import assert from "node:assert/strict";
import {
  GOV_TASK_73_CONTRACT_KEY,
  GOV_TASK_73_SCOPE_KEY,
  hasClosedLifecycle,
  isAiceoGovTask73Contract,
} from "../artifacts/api-server/src/routes/aiceoGov";
import { AICEO_ROLE_GOVERNANCE_RULE_ID } from "../artifacts/api-server/src/lib/aiceoGovernanceRoot";

const valid = {
  idempotencyKey: GOV_TASK_73_CONTRACT_KEY,
  continuityRevision: 49,
  scope: { [GOV_TASK_73_SCOPE_KEY]: "73" },
  frozenRules: [{ id: AICEO_ROLE_GOVERNANCE_RULE_ID }],
};

assert.equal(isAiceoGovTask73Contract(valid), true);
assert.equal(isAiceoGovTask73Contract({
  ...valid,
  idempotencyKey: "another-revision-49-role-contract",
}), false);
assert.equal(isAiceoGovTask73Contract({
  ...valid,
  scope: { [GOV_TASK_73_SCOPE_KEY]: "74" },
}), false);
assert.equal(isAiceoGovTask73Contract({
  ...valid,
  frozenRules: [],
}), false);
assert.equal(hasClosedLifecycle([{ state: "VERIFIED" }]), false);
assert.equal(hasClosedLifecycle([{ state: "VERIFIED" }, { state: "CLOSED" }]), true);

console.log(JSON.stringify({
  exactTaskBinding: true,
  wrongRunRejected: true,
  closureReplayRejected: true,
}));