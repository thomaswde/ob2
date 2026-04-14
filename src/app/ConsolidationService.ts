import type { LanguageModel } from "../domain/languageModel.js";
import type { Repository } from "../domain/repository.js";
import type {
  CorrectionAction,
  Entity,
  MemoryAtom,
} from "../domain/types.js";
import { makeId } from "../utils/crypto.js";
import { ConsolidatedProjectionCompiler, type ConsolidatedProjectionCompilerHooks } from "./ConsolidatedProjectionCompiler.js";

export interface ConsolidationServiceOptions {
  rootDir?: string;
  compilerHooks?: ConsolidatedProjectionCompilerHooks;
}

export interface ConsolidationResult {
  runId: string;
  status: "completed" | "aborted" | "aborted_low_confidence";
  atomCount: number;
  lowConfidenceCount: number;
  errorCount: number;
  outputPath: string | null;
  reviewItemsCreated: number;
  appliedCorrectionIds: string[];
}

interface PendingAtomAction {
  atom: MemoryAtom;
  entity: Entity | null;
  confidence: "high" | "low";
  contradictionAtomIds: string[];
  supersedesAtomId: string | null;
  relatedEntitySlugs: string[];
}

function inferFieldKey(content: string): string {
  const lower = content.toLowerCase();
  if (lower.includes("work") && (lower.includes(" at ") || lower.includes("works at") || lower.includes("employ"))) {
    return "employment";
  }
  if (lower.includes("married")) {
    return "marital-status";
  }
  if (lower.includes("lives in")) {
    return "residence";
  }
  return "generic";
}

function likelyContradiction(a: string, b: string): boolean {
  const fieldA = inferFieldKey(a);
  const fieldB = inferFieldKey(b);
  if (fieldA !== fieldB || fieldA === "generic") {
    return false;
  }
  if (fieldA === "employment") {
    return false;
  }
  return a.trim().toLowerCase() !== b.trim().toLowerCase();
}

function likelySupersession(newAtom: MemoryAtom, existingAtom: MemoryAtom): boolean {
  const fieldNew = inferFieldKey(newAtom.content);
  const fieldExisting = inferFieldKey(existingAtom.content);
  return fieldNew !== "generic" && fieldNew === fieldExisting && newAtom.content !== existingAtom.content;
}

export class ConsolidationService {
  constructor(
    private readonly repository: Repository,
    private readonly languageModel: LanguageModel,
    private readonly options: ConsolidationServiceOptions = {},
  ) {}

  async forceEnable(): Promise<void> {
    await this.repository.updateSystemState({
      consolidationEnabled: true,
      consecutiveAbortedRuns: 0,
    });
  }

  async proposeCorrection(targetAtomId: string | null, proposedContent: string, reason?: string): Promise<CorrectionAction> {
    return this.repository.createCorrectionAction({
      id: makeId(),
      targetAtomId,
      proposedContent,
      reason: reason ?? null,
      status: "proposed",
    });
  }

  private async resolveCandidateEntities(atom: MemoryAtom): Promise<Entity[]> {
    if (atom.entityId) {
      const currentEntity = await this.repository.getEntityById(atom.entityId);
      if (currentEntity?.parentEntityId) {
        return this.repository.listEntitiesByParent(currentEntity.parentEntityId);
      }
    }

    const entities = await this.repository.listNonCategoryEntitiesWithCategory();
    return entities;
  }

  private async planPendingAtom(atom: MemoryAtom): Promise<PendingAtomAction> {
    const candidates = await this.resolveCandidateEntities(atom);
    const currentEntity = atom.entityId ? await this.repository.getEntityById(atom.entityId) : null;
    const classification = await this.languageModel.classifyConsolidation({
      atomId: atom.id,
      atomContent: atom.content,
      likelyEntitySlug: currentEntity?.slug ?? null,
      candidateEntities: candidates.map((entity) => ({
        id: entity.id,
        slug: entity.slug,
        name: entity.name,
        type: entity.type,
      })),
    });

    const entity =
      (classification.entitySlug ? await this.repository.getEntityBySlug(classification.entitySlug) : null) ??
      currentEntity;

    const cluster = entity ? await this.repository.listAtomsForEntity(entity.id) : [];
    const candidateAtoms = cluster.filter((candidate) => candidate.id !== atom.id);
    let contradictionAtomIds: string[] = [];
    let supersedesAtomId: string | null = null;

    if (entity) {
      const decision = await this.languageModel.decideConsolidation({
        atomId: atom.id,
        atomContent: atom.content,
        entitySlug: entity.slug,
        candidateAtoms: candidateAtoms.map((candidate) => ({
          id: candidate.id,
          content: candidate.content,
          sourceRef: candidate.sourceRef,
          validAt: candidate.validAt?.toISOString() ?? null,
          invalidAt: candidate.invalidAt?.toISOString() ?? null,
        })),
      });

      contradictionAtomIds = decision.contradictionAtomIds;
      supersedesAtomId = decision.supersedesAtomId;

      if (decision.confidence === "low" && classification.confidence !== "low") {
        return {
          atom,
          entity,
          confidence: "low",
          contradictionAtomIds,
          supersedesAtomId,
          relatedEntitySlugs: classification.links.map((link) => link.entitySlug),
        };
      }

      if (contradictionAtomIds.length === 0) {
        contradictionAtomIds = candidateAtoms
          .filter((candidate) => candidate.invalidAt === null && likelyContradiction(atom.content, candidate.content))
          .map((candidate) => candidate.id);
      }

      if (contradictionAtomIds.length > 0) {
        supersedesAtomId = null;
      } else if (!supersedesAtomId) {
        const heuristicSuperseded = candidateAtoms.find((candidate) => likelySupersession(atom, candidate));
        supersedesAtomId = heuristicSuperseded?.id ?? null;
      }
    }

    return {
      atom,
      entity,
      confidence: classification.confidence,
      contradictionAtomIds,
      supersedesAtomId,
      relatedEntitySlugs: classification.links.map((link) => link.entitySlug),
    };
  }

  private async applyPlannedAtom(action: PendingAtomAction): Promise<number> {
    let reviewItemsCreated = 0;
    const entity = action.entity;

    if (entity) {
      await this.repository.updateMemoryAtom({
        id: action.atom.id,
        entityId: entity.id,
      });
    }

    if (entity) {
      for (const slug of action.relatedEntitySlugs) {
        const related = await this.repository.getEntityBySlug(slug);
        if (!related || related.id === entity.id) {
          continue;
        }
        await this.repository.createEntityLink({
          id: makeId(),
          entityId: entity.id,
          relatedEntityId: related.id,
          relationshipType: "related_to",
          confidence: 0.8,
          evidenceAtomId: action.atom.id,
        });
      }
    }

    for (const contradictionAtomId of action.contradictionAtomIds) {
      await this.repository.createReviewItem({
        id: makeId(),
        atomId: contradictionAtomId,
        kind: "contradiction",
        detail: `Atom ${action.atom.id} conflicts with ${contradictionAtomId}: ${action.atom.content}`,
      });
      reviewItemsCreated += 1;
    }

    if (action.supersedesAtomId) {
      const prior = await this.repository.getMemoryAtomById(action.supersedesAtomId);
      if (prior?.locked) {
        await this.repository.createReviewItem({
          id: makeId(),
          atomId: prior.id,
          kind: "other",
          detail: `Atom ${action.atom.id} may supersede ${prior.id}, but the prior atom is locked.`,
        });
        reviewItemsCreated += 1;
      } else if (prior) {
        const invalidAt = action.atom.validAt ?? action.atom.createdAt;
        await this.repository.updateMemoryAtom({
          id: prior.id,
          invalidAt,
        });
        await this.repository.updateMemoryAtom({
          id: action.atom.id,
          supersedesId: prior.id,
        });
      }
    }

    await this.repository.updateMemoryAtom({
      id: action.atom.id,
      consolidationStatus: "processed",
    });

    return reviewItemsCreated;
  }

  private async processCorrection(action: CorrectionAction): Promise<{ applied: boolean; reviewItemsCreated: number }> {
    const target = action.targetAtomId ? await this.repository.getMemoryAtomById(action.targetAtomId) : null;
    if (!target || !target.entityId || target.locked) {
      await this.repository.updateCorrectionActionStatus(action.id, "under_review");
      return { applied: false, reviewItemsCreated: 0 };
    }

    const cluster = await this.repository.listAtomsForEntity(target.entityId);
    const decision = await this.languageModel.decideConsolidation({
      atomId: action.id,
      atomContent: action.proposedContent,
      entitySlug: (await this.repository.getEntityById(target.entityId))?.slug ?? "unknown",
      candidateAtoms: cluster.map((candidate) => ({
        id: candidate.id,
        content: candidate.content,
        sourceRef: candidate.sourceRef,
        validAt: candidate.validAt?.toISOString() ?? null,
        invalidAt: candidate.invalidAt?.toISOString() ?? null,
      })),
    });

    const shouldApply = decision.confidence === "high" && (decision.supersedesAtomId === target.id || likelySupersession({
      ...target,
      id: action.id,
      content: action.proposedContent,
    }, target));

    if (!shouldApply) {
      await this.repository.updateCorrectionActionStatus(action.id, "under_review");
      return { applied: false, reviewItemsCreated: 0 };
    }

    const applied = await this.repository.createMemoryAtom({
      id: makeId(),
      content: action.proposedContent,
      contentFingerprint: `${action.id}:correction`,
      entityId: target.entityId,
      sourceRef: `correction:${action.id}`,
      sourceAgent: "consolidation",
      importance: target.importance,
      confidence: 0.95,
      decayClass: target.decayClass,
      validAt: new Date(),
      invalidAt: null,
      metadata: { correctionActionId: action.id },
    });

    await this.repository.updateMemoryAtom({
      id: applied.id,
      supersedesId: target.id,
      consolidationStatus: "processed",
    });
    await this.repository.updateMemoryAtom({
      id: target.id,
      invalidAt: applied.validAt ?? new Date(),
    });
    await this.repository.updateCorrectionActionStatus(action.id, "applied");
    return { applied: true, reviewItemsCreated: 0 };
  }

  async applyCorrection(correctionId: string): Promise<void> {
    const correction = (await this.repository.listCorrectionActions()).find((item) => item.id === correctionId);
    if (!correction) {
      throw new Error(`Correction not found: ${correctionId}`);
    }

    const result = await this.processCorrection(correction);
    if (!result.applied) {
      throw new Error(`Correction ${correctionId} could not be auto-applied and remains under review.`);
    }
  }

  async run(): Promise<ConsolidationResult> {
    const state = await this.repository.getSystemState();
    if (!state.consolidationEnabled) {
      throw new Error("Consolidation is disabled after repeated aborted runs. Use --force-enable to re-enable it.");
    }

    const pendingAtoms = await this.repository.listPendingAtoms();
    const run = await this.repository.createConsolidationRun({
      id: makeId(),
      status: "pending",
      atomCount: pendingAtoms.length,
    });

    const planned: PendingAtomAction[] = [];
    let lowConfidenceCount = 0;
    let errorCount = 0;

    for (const atom of pendingAtoms) {
      try {
        const action = await this.planPendingAtom(atom);
        planned.push(action);
        if (action.confidence === "low") {
          lowConfidenceCount += 1;
        }
      } catch {
        errorCount += 1;
      }
    }

    if ((pendingAtoms.length > 0 && lowConfidenceCount / pendingAtoms.length > 0.2) || errorCount > 5) {
      const nextAbortCount = state.consecutiveAbortedRuns + 1;
      await this.repository.completeConsolidationRun({
        id: run.id,
        status: lowConfidenceCount / Math.max(pendingAtoms.length, 1) > 0.2 ? "aborted_low_confidence" : "aborted",
        atomCount: pendingAtoms.length,
        processedAtomCount: 0,
        lowConfidenceAtomCount: lowConfidenceCount,
        errorCount,
        notes: "Consolidation aborted by circuit breaker.",
        errorMessage: errorCount > 5 ? "Too many consolidation errors." : null,
        metadata: {},
      });
      await this.repository.updateSystemState({
        consecutiveAbortedRuns: nextAbortCount,
        consolidationEnabled: nextAbortCount >= 3 ? false : state.consolidationEnabled,
      });
      return {
        runId: run.id,
        status: lowConfidenceCount / Math.max(pendingAtoms.length, 1) > 0.2 ? "aborted_low_confidence" : "aborted",
        atomCount: pendingAtoms.length,
        lowConfidenceCount,
        errorCount,
        outputPath: null,
        reviewItemsCreated: 0,
        appliedCorrectionIds: [],
      };
    }

    let reviewItemsCreated = 0;
    for (const action of planned) {
      reviewItemsCreated += await this.applyPlannedAtom(action);
    }

    const correctionActions = await this.repository.listCorrectionActions(["proposed", "under_review"]);
    const appliedCorrectionIds: string[] = [];
    for (const correction of correctionActions) {
      const result = await this.processCorrection(correction);
      reviewItemsCreated += result.reviewItemsCreated;
      if (result.applied) {
        appliedCorrectionIds.push(correction.id);
      }
    }

    const compiler = new ConsolidatedProjectionCompiler(
      this.repository,
      this.languageModel,
      this.options.rootDir,
      this.options.compilerHooks,
    );
    const compiled = await compiler.compile();

    await this.repository.completeConsolidationRun({
      id: run.id,
      status: "completed",
      atomCount: pendingAtoms.length,
      processedAtomCount: planned.length,
      lowConfidenceAtomCount: lowConfidenceCount,
      errorCount,
      notes: `Processed ${pendingAtoms.length} pending atoms.`,
      errorMessage: null,
      metadata: {},
    });
    await this.repository.updateSystemState({
      consolidationEnabled: true,
      consecutiveAbortedRuns: 0,
    });

    return {
      runId: run.id,
      status: "completed",
      atomCount: pendingAtoms.length,
      lowConfidenceCount,
      errorCount,
      outputPath: compiled.outputPath,
      reviewItemsCreated,
      appliedCorrectionIds,
    };
  }
}
