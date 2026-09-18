import { and, desc, eq, gt } from "drizzle-orm";
import {
  aiceoSelfCheckReportsTable, db,
  type AiceoSelfCheckScope, type AiceoSelfCheckStatus,
} from "@workspace/db";
import { assertCredentialPersistenceSafe } from "./aiceoCredentialPersistenceFirewall";

export type SelfCheckReportInput = {
  projectId: string;
  runId: string;
  scope: AiceoSelfCheckScope;
  chainKey: string;
  moduleKey?: string;
  status: AiceoSelfCheckStatus;
  checkedAt: Date;
  validUntil: Date;
  dimensions?: Record<string, AiceoSelfCheckStatus>;
  summary: Record<string, unknown>;
  anomalies?: string[];
  evidenceLineage: Record<string, unknown>[];
  childReportIds?: string[];
  faultDomains?: string[];
  escalation: "none" | "chain" | "global";
  diagnosticDepth?: "summary" | "deep";
  escalationReason?: string;
  rawPayloadIncluded?: boolean;
  transaction?: any;
};

export const aiceoSelfChecks = {
  async createReport(input: SelfCheckReportInput) {
    const { transaction: _transaction, ...persistentInput } = input;
    assertCredentialPersistenceSafe(persistentInput, "self-check-report");
    const operation = async (tx: any) => {
      const [report] = await tx.insert(aiceoSelfCheckReportsTable).values({
        projectId: input.projectId,
        runId: input.runId,
        scope: input.scope,
        chainKey: input.chainKey,
        moduleKey: input.moduleKey,
        contractVersion: "G1-001-SC-1",
        status: input.status,
        checkedAt: input.checkedAt,
        validUntil: input.validUntil,
        dimensions: input.dimensions ?? {},
        summary: input.summary,
        anomalies: input.anomalies ?? [],
        evidenceLineage: input.evidenceLineage,
        childReportIds: input.childReportIds ?? [],
        faultDomains: input.faultDomains ?? [],
        escalation: input.escalation,
        diagnosticDepth: input.diagnosticDepth ?? "summary",
        escalationReason: input.escalationReason,
        rawPayloadIncluded: input.rawPayloadIncluded ?? false,
        appendSequence: 0,
        reportHash: "db-owned",
        independentValidation: false,
        closureAuthority: false,
        productionAuthority: false,
      }).returning();
      return report;
    };
    return input.transaction ? operation(input.transaction) : db.transaction(operation);
  },

  async latestHealthSummary(projectId: string, transaction?: any) {
    const executor = transaction ?? db;
    const reports = await executor.select({
      id: aiceoSelfCheckReportsTable.id,
      runId: aiceoSelfCheckReportsTable.runId,
      scope: aiceoSelfCheckReportsTable.scope,
      chainKey: aiceoSelfCheckReportsTable.chainKey,
      moduleKey: aiceoSelfCheckReportsTable.moduleKey,
      contractVersion: aiceoSelfCheckReportsTable.contractVersion,
      status: aiceoSelfCheckReportsTable.status,
      checkedAt: aiceoSelfCheckReportsTable.checkedAt,
      validUntil: aiceoSelfCheckReportsTable.validUntil,
      summary: aiceoSelfCheckReportsTable.summary,
      anomalies: aiceoSelfCheckReportsTable.anomalies,
      faultDomains: aiceoSelfCheckReportsTable.faultDomains,
      diagnosticDepth: aiceoSelfCheckReportsTable.diagnosticDepth,
      reportHash: aiceoSelfCheckReportsTable.reportHash,
    }).from(aiceoSelfCheckReportsTable)
      .where(and(
        eq(aiceoSelfCheckReportsTable.projectId, projectId),
        gt(aiceoSelfCheckReportsTable.validUntil, new Date()),
      ))
      .orderBy(desc(aiceoSelfCheckReportsTable.appendSequence))
      .limit(100);
    return reports;
  },
};