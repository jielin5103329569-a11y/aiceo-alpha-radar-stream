import type { AiceoFutureMemorySpace } from "@workspace/db";

export const PRECLASSIFICATION_SEED_BATCH = "g1-001-owner-high-value-themes-2026-09-17";
export const PRECLASSIFICATION_OBSERVED_AT = new Date("2026-09-17T13:45:00.000Z");
const sharedContext = {
  context: "Owner directed AICEO to preserve this high-value idea before scientific Memory OS classification is complete.",
  classificationDeferred: true,
  originalLanguage: "zh-CN",
  timePrecision: "session_observed_at",
  provenanceIntent: "Preserve original semantics now; classify or split scientifically later with originInboxId and originHash lineage.",
};
const item = (stableKey: string, title: string, rawSemantics: string, hints: AiceoFutureMemorySpace[]) => ({
  stableKey, rawSemantics: `${title}：${rawSemantics}`, futureClassificationHints: hints,
  sourceContext: { ...sharedContext, title },
});
export const PRECLASSIFICATION_HIGH_VALUE_THEMES = [
  item("human-ai-compound-intelligence", "Human–AI Compound Intelligence",
    "人的感知、思想连续性、价值与最终判断，与 AI 的知识、推理、记忆、连续生产力及无人体疲劳/情绪体验的处理特征形成复合智能；所有结论仍受 Evidence、Independent Validation 与 Reality Feedback 约束。",
    ["knowledge_memory","decision_memory","collaboration_memory"]),
  item("thought-continuity", "Thought Continuity",
    "保存 Motivation→Context→Observation→Interpretation→Belief/Hypothesis→Principle→Decision→Action→Outcome→Reflection→Updated Belief→Next Decision 因果链，保持思想连续但允许现实纠正。",
    ["knowledge_memory","experience_learning_memory","decision_memory"]),
  item("owner-long-term-motivation-causal-chain", "Owner 长期动机因果链",
    "建立 AICEO→创造现实价值→获得更多资源→继续投入 AI/数据/工具→能力增强→承担更大项目→继续创造价值，同时保护跨模型、跨 Agent、跨时间的协作连续性。",
    ["project_roadmap_memory","decision_memory","collaboration_memory"]),
  item("layered-self-check-architecture", "分层自检架构",
    "Local Self-Check→Chain Health Check→Global Integrity Check；异常逐级扩展诊断，降低全量扫描成本；Self-Check 不等于 Independent Validation。",
    ["knowledge_memory","experience_learning_memory","project_roadmap_memory"]),
  item("causal-attribution-model-diagnosis", "Causal Attribution & Model Diagnosis",
    "系统运行正常但结果不理想时，用可观测因果链、Counterfactual、Ablation、Marginal Contribution、Calibration、Regime Attribution、Root Cause 与 Forward Validation 判断各环节为正贡献、零贡献或负贡献。",
    ["knowledge_memory","experience_learning_memory","decision_memory"]),
  item("bidirectional-causal-learning", "Bidirectional Causal Learning",
    "事前顺推并冻结预测链，事后从实际结果倒推，结合反事实、必要/充分条件、贡献/放大/抑制/触发因素、交互效应、时间滞后和独立验证，防止把成功等同判断正确或把失败等同模型错误。",
    ["knowledge_memory","experience_learning_memory","decision_memory"]),
  item("failure-intelligence", "Failure Intelligence",
    "知道错在哪里可能比知道为什么成功更重要。记录 Failure→故障域→根因候选→因果证据→可控/不可控→可重复/偶发→修复→反事实→Shadow 复验→同类失败率是否下降；保存 Near Miss，遵守成功中的错误也要学习、失败中的正确也要保留；目标是缩小可避免失败空间，而非幻想成功率 100%。",
    ["experience_learning_memory","knowledge_memory","project_roadmap_memory"]),
  item("failure-boundary-map", "Failure Boundary Map",
    "长期识别系统在哪些条件下可靠、变弱、应降低风险或不应行动；同一种可避免错误尽量不要重复。",
    ["experience_learning_memory","decision_memory","knowledge_memory"]),
] as const;