import assert from "node:assert/strict";
import {
  AICEO_AGENT_AUTHORITY,
  AICEO_BRAIN_AUTHORITY,
  AICEO_GOVERNANCE_ROOT_VERSION,
  AICEO_OWNER_AUTHORITY,
  ownerGovernanceApprovalHash,
  validateGovernanceDeclaration,
} from "../artifacts/api-server/src/lib/aiceoGovernanceRoot.ts";

assert.equal(AICEO_GOVERNANCE_ROOT_VERSION, "IMPL-001");
assert.equal(AICEO_OWNER_AUTHORITY, "ultimate_human_governance_authority");
assert.match(AICEO_BRAIN_AUTHORITY, /maximum_technical_sovereignty/);
assert.equal(AICEO_AGENT_AUTHORITY, "delegated_technical_authority");

assert.throws(
  () => validateGovernanceDeclaration(undefined, "contract.echo", "synthetic"),
  /unclassified tasks fail closed/,
);
assert.throws(
  () => validateGovernanceDeclaration(
    { classification: "ordinary_technical", redLines: ["legal_liability"] },
    "contract.echo",
    "synthetic",
  ),
  /conflicting ordinary classification/,
);
assert.throws(
  () => validateGovernanceDeclaration(
    { classification: "ordinary_technical", redLines: [] },
    "governance.mutate",
    "synthetic",
  ),
  /unknown or mutating capability/,
);
assert.throws(
  () => validateGovernanceDeclaration(
    { classification: "owner_protection", redLines: [] },
    "contract.echo",
    "synthetic",
  ),
  /requires at least one red line/,
);
assert.deepEqual(
  validateGovernanceDeclaration(
    { classification: "ordinary_technical", redLines: [] },
    "contract.echo",
    "synthetic development text",
  ),
  { classification: "ordinary_technical", redLines: [] },
);

const approval = {
  taskId: "task-1",
  taskIntent: {
    action: "contract.echo",
    resource: "synthetic development text",
    permissions: { actions: ["contract.echo"] },
    sourceId: "source-1",
    policyId: "policy-1",
    contractVersion: "ARCH-001",
    contractHash: "contract-hash",
    environment: "development",
    authority: "grok_restricted_development",
    budget: { estimatedTokens: 1024, estimatedCalls: 1, estimatedUsd: "0.0512" },
    timeoutMs: 10000,
    maxRetries: 0,
  },
  classification: "owner_protection",
  redLines: ["aiceo_system_integrity"],
  submission: {
    eventId: "submission-event-1",
    eventHash: "submission-hash-1",
    actorId: "operator-1",
  },
  ownerId: "owner-1",
  approvedAt: new Date("2026-09-17T12:00:00.000Z"),
};
const secret = "test-only-owner-approval-secret-32-bytes";
const hash = ownerGovernanceApprovalHash(approval, secret);
assert.equal(hash, ownerGovernanceApprovalHash(approval, secret), "identical Owner approval evidence is deterministic");
assert.notEqual(
  hash,
  ownerGovernanceApprovalHash({ ...approval, ownerId: "agent-forged-owner" }, secret),
  "Owner identity is bound into immutable approval evidence",
);
assert.notEqual(
  hash,
  ownerGovernanceApprovalHash({ ...approval, submission: { ...approval.submission, actorId: "owner-1" } }, secret),
  "submission identity and independence evidence are bound into immutable approval evidence",
);
assert.notEqual(
  hash,
  ownerGovernanceApprovalHash({ ...approval, redLines: ["legal_liability"] }, secret),
  "approved red lines cannot be substituted",
);
assert.notEqual(
  hash,
  ownerGovernanceApprovalHash({ ...approval, taskIntent: { ...approval.taskIntent, resource: "substituted task content" } }, secret),
  "full approved task intent cannot be substituted",
);
assert.throws(
  () => ownerGovernanceApprovalHash(approval, "public-unkeyed-hash"),
  /signing authority is unavailable/,
);

console.log("IMPL-001 Governance Root passed: authority hierarchy, triad classification, fail-closed handling, and immutable Owner approval identity.");