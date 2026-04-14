import type { EntityType, ExtractSchema, QueryClassifierDecision, QuerySchema } from "./types.js";

export interface EntitySelectionResult {
  slugs: string[];
  confidence: "high" | "low";
}

export interface ConsolidationClassificationCandidate {
  id: string;
  slug: string;
  name: string;
  type: EntityType;
  summary?: string | null;
}

export interface ConsolidationClassificationInput {
  atomId?: string;
  atomContent: string;
  likelyEntitySlug?: string | null;
  candidateEntities: ConsolidationClassificationCandidate[];
}

export interface ConsolidationClassificationLink {
  entitySlug: string;
  relation: "member_of" | "related_to";
  confidence: "high" | "low";
  reason: string;
}

export interface ConsolidationClassificationResult {
  entitySlug: string | null;
  confidence: "high" | "low";
  reason: string;
  links: ConsolidationClassificationLink[];
}

export interface ConsolidationDecisionCandidate {
  id: string;
  content: string;
  sourceRef?: string;
  validAt?: string | null;
  invalidAt?: string | null;
}

export interface ConsolidationDecisionInput {
  atomId?: string;
  atomContent: string;
  entitySlug: string;
  candidateAtoms: ConsolidationDecisionCandidate[];
}

export interface ConsolidationDecisionResult {
  supersedesAtomId: string | null;
  contradictionAtomIds: string[];
  confidence: "high" | "low";
  reason: string;
}

export interface EntitySummarySourceAtom {
  id: string;
  content: string;
  sourceRef?: string;
}

export interface EntitySummaryClaim {
  text: string;
  sourceAtomIds: string[];
}

export interface EntitySummarySynthesisInput {
  entitySlug: string;
  entityName: string;
  entityType: EntityType;
  atoms: EntitySummarySourceAtom[];
  existingSummary?: string | null;
}

export interface EntitySummarySynthesisResult {
  summary: string;
  claims: EntitySummaryClaim[];
  confidence: "high" | "low";
}

export interface LifeStateSynthesisInput {
  atomsByCategory: Array<{
    categoryName: string;
    atoms: EntitySummarySourceAtom[];
  }>;
}

export interface LifeStateSynthesisResult {
  narrative: string;
  confidence: "high" | "low";
}

export interface LanguageModel {
  classify(prompt: string, schema: QuerySchema): Promise<QueryClassifierDecision>;
  summarize(prompt: string): Promise<string>;
  extract(prompt: string, schema: ExtractSchema): Promise<EntitySelectionResult>;
  classifyConsolidation(input: ConsolidationClassificationInput): Promise<ConsolidationClassificationResult>;
  decideConsolidation(input: ConsolidationDecisionInput): Promise<ConsolidationDecisionResult>;
  synthesizeEntitySummary(input: EntitySummarySynthesisInput): Promise<EntitySummarySynthesisResult>;
  synthesizeLifeState(input: LifeStateSynthesisInput): Promise<LifeStateSynthesisResult>;
}
