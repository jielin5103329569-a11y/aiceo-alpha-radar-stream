import { createHmac } from "node:crypto";

export const AICEO_GOVERNANCE_ROOT_VERSION = "IMPL-001";
export const AICEO_OWNER_AUTHORITY = "ultimate_human_governance_authority";
export const AICEO_BRAIN_AUTHORITY = "maximum_technical_sovereignty_below_owner_red_lines";
export const AICEO_AGENT_AUTHORITY = "delegated_technical_authority";
export const AICEO_ROLE_GOVERNANCE_PROFILE_VERSION = "AICEO-ROLE-GOVERNANCE-V1";
export const AICEO_PRIMARY_TECHNICAL_BRAIN_ACTOR_ID = "xai:grok-primary-technical-brain";
export const AICEO_OWNER_SIDE_GOVERNANCE_ACTOR_ID = "chatgpt:bro-owner-side-governance-verification";
export const AICEO_ROLE_GOVERNANCE_RULE_ID = "aiceo-primary-technical-brain-role-profile";

export const OWNER_PROTECTION_RED_LINES = [
  "financial_and_physical_assets",
  "legal_liability",
  "aiceo_system_integrity",
] as const;
export type OwnerProtectionRedLine = (typeof OWNER_PROTECTION_RED_LINES)[number];
export type GovernanceClassification = "ordinary_technical" | "owner_protection" | "legacy_unclassified";

export type GovernanceDeclaration = {
  classification: GovernanceClassification;
  redLines: OwnerProtectionRedLine[];
};

const NON_MUTATING_DEVELOPMENT_ACTIONS = new Set(["contract.echo", "development.analyze"]);

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
};

export function aiceoRoleGovernanceProfile() {
  return {
    id: AICEO_ROLE_GOVERNANCE_RULE_ID,
    version: AICEO_ROLE_GOVERNANCE_PROFILE_VERSION,
    primaryTechnicalBrain: {
      actorId: AICEO_PRIMARY_TECHNICAL_BRAIN_ACTOR_ID,
      provider: "xai_grok",
      role: "primary_technical_brain",
      authority: AICEO_BRAIN_AUTHORITY,
      responsibilities: [
        "code",
        "engineering_implementation",
        "root_cause_diagnosis",
        "runtime_debug",
        "integration",
        "technical_execution_decisions",
      ],
    },
    ownerSideGovernanceAndVerification: {
      laneId: AICEO_OWNER_SIDE_GOVERNANCE_ACTOR_ID,
      role: "owner_side_governance_and_verification",
      authority: "owner_delegated_governance_verification",
      runtimePrincipalBinding: {
        authorizationRole: "aiceo_validator",
        actorIdSource: "server_authenticated_user_id",
        exclusiveRoleRequired: true,
      },
      responsibilities: [
        "owner_intent_translation",
        "governance_and_red_line_protection",
        "task_contracts",
        "evidence_organization",
        "independent_acceptance",
        "closure",
      ],
    },
    executionResultDisposition: "evidence_then_awaiting_verification",
    closureAuthority: "independent_owner_side_validator",
    selfVerificationAllowed: false,
    ownerProtectionTriadPreserved: true,
    redLineChangesRequireExplicitOwnerApproval: true,
    createsGovernanceAuthority: false,
    productionAuthority: false,
  } as const;
}

export function assertAiceoRoleGovernanceProfile(value: unknown): void {
  if (
    JSON.stringify(canonical(value))
      !== JSON.stringify(canonical(aiceoRoleGovernanceProfile()))
  ) {
    throw new Error("不能：AICEO role governance profile is missing, altered, or authority-expanding");
  }
}

export function validateGovernanceDeclaration(
  declaration: GovernanceDeclaration | null | undefined,
  action: string,
  resource: string,
): GovernanceDeclaration {
  if (!declaration) throw new Error("IMPL-001 governance classification is required; unclassified tasks fail closed");
  const redLines = [...new Set(declaration.redLines)];
  if (redLines.some((item) => !OWNER_PROTECTION_RED_LINES.includes(item))) {
    throw new Error("IMPL-001 unknown Owner Protection red line; task rejected");
  }
  if (declaration.classification === "ordinary_technical") {
    if (redLines.length) throw new Error("IMPL-001 conflicting ordinary classification and Owner Protection red lines");
    if (!NON_MUTATING_DEVELOPMENT_ACTIONS.has(action) || !resource.trim()) {
      throw new Error("IMPL-001 unknown or mutating capability cannot be classified as ordinary technical work");
    }
    return { classification: declaration.classification, redLines: [] };
  }
  if (declaration.classification === "owner_protection") {
    if (!redLines.length) throw new Error("IMPL-001 Owner Protection classification requires at least one red line");
    return { classification: declaration.classification, redLines };
  }
  throw new Error("IMPL-001 unknown governance classification; task rejected");
}

export function ownerGovernanceApprovalHash(input: {
  taskId: string;
  taskIntent: {
    action: string;
    resource: string;
    permissions: unknown;
    sourceId: string | null;
    policyId: string | null;
    contractVersion: string;
    contractHash: string;
    environment: string;
    authority: string;
    budget: unknown;
    timeoutMs: number;
    maxRetries: number;
  };
  classification: "owner_protection";
  redLines: OwnerProtectionRedLine[];
  submission: {
    eventId: string;
    eventHash: string;
    actorId: string;
  };
  ownerId: string;
  approvedAt: Date;
}, secret: string): string {
  if (secret.length < 32) throw new Error("IMPL-001 Owner approval signing authority is unavailable");
  return createHmac("sha256", secret).update(JSON.stringify(canonical({
    governanceRootVersion: AICEO_GOVERNANCE_ROOT_VERSION,
    ...input,
    approvedAt: input.approvedAt.toISOString(),
  }))).digest("hex");
}
