import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiceoContinuityStateTable,
  aiceoExecutionContractsTable,
} from "@workspace/db/schema";
import { AiceoAgentExecutionProtocol } from "../artifacts/api-server/src/lib/aiceoAgentExecutionProtocol";
import {
  AICEO_OWNER_SIDE_GOVERNANCE_ACTOR_ID,
  AICEO_PRIMARY_TECHNICAL_BRAIN_ACTOR_ID,
} from "../artifacts/api-server/src/lib/aiceoGovernanceRoot";
import { GOV_RP_001_CONTRACT_KEY } from "../artifacts/api-server/src/routes/aiceoGov";

const OWNER_CLERK_USER_ID = "user_3IjRrER6pNhqlWFjlCGrSSt2ds5";

async function main() {
  const contract = await db.transaction(async (tx) => {
    const existing = (await tx.select().from(aiceoExecutionContractsTable)
      .where(eq(aiceoExecutionContractsTable.idempotencyKey, GOV_RP_001_CONTRACT_KEY))
      .limit(1))[0];
    if (existing) return existing;

    const continuity = (await tx.select().from(aiceoContinuityStateTable).limit(1))[0];
    if (!continuity || continuity.revision !== 49) {
      throw new Error("RP-001 issuance requires current continuity revision 49.");
    }

    const protocol = new AiceoAgentExecutionProtocol(tx, true);
    return protocol.issue({
      idempotencyKey: GOV_RP_001_CONTRACT_KEY,
      ownerIntent: "Bro，继续",
      intentUnderstanding: {
        certainty: "HIGH",
        interpretedIntent: "Resume",
        actionTarget: "resume",
        confirmationSummary: "Resume the already-authorized RP-001 role-profile recording.",
        reasonableInterpretations: [{
          meaning: "Resume the already-authorized RP-001 role-profile recording.",
          actionTarget: "resume",
        }],
        materiallyDifferentActions: false,
        contextHighlyClear: true,
        stableAlias: true,
        verifiedExpressionPattern: false,
        riskLevel: "LOW",
      },
      continuityRevision: 49,
      scope: {
        record: "RP-001",
        role: "AICEO Primary Technical Lead / Technical Brain",
        identity: AICEO_PRIMARY_TECHNICAL_BRAIN_ACTOR_ID,
        readOnly: true,
      },
      objective: "Persist the Grok technical-brain role and its non-governance authority boundaries.",
      allowedCapabilities: ["code.inspect"],
      deniedCapabilities: [],
      frozenRules: [{
        id: "rp-001-independent-owner-binding",
        clerkUserId: OWNER_CLERK_USER_ID,
        role: "aiceo_owner",
        independentFromExecutionIdentity: AICEO_PRIMARY_TECHNICAL_BRAIN_ACTOR_ID,
        executionIsVerification: false,
        productionAuthority: false,
      }],
      completionDefinition: {
        roleProfilePersisted: true,
        executionAuthoritySeparatedFromVerification: true,
        task73RemainsClosed: true,
      },
      evidenceRequirements: [{ type: "role-authority-boundary" }],
      executionPolicy: {
        timeoutMs: 300_000,
        maxRetries: 0,
        maxCalls: 1,
        maxCostMicrousd: 0,
        checkpointRequired: false,
      },
      resumeNode: { node: "rp-001-read-only" },
      escalationConditions: [{ target: "owner", condition: "authority_boundary_change_requested" }],
      ownerAttentionBudget: {
        maxOwnerInterruptions: 1,
        mergeHumanActions: true,
        noScreenshotWhenAutoVerifiable: true,
      },
      maxDelegationDepth: 0,
    }, AICEO_OWNER_SIDE_GOVERNANCE_ACTOR_ID, "aiceo_validator");
  });

  console.log(JSON.stringify({
    contractId: contract.id,
    revision: contract.continuityRevision,
    status: contract.status,
    identity: contract.brainActorId,
    productionAuthority: contract.productionAuthority,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});