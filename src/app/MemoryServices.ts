import type { LanguageModel } from "../domain/languageModel.js";
import type { Repository } from "../domain/repository.js";
import type {
  AutomationTriggerResult,
  CaptureMemoryInput,
  CreateRequestLogInput,
  CorrectionAction,
  EntityDetail,
  ExportResult,
  MemoryAtom,
  QueryMemoryResult,
  RequestLog,
} from "../domain/types.js";
import { captureMemory, type EmbeddingServiceLike } from "./captureMemory.js";
import { ConsolidationService, type ConsolidationResult } from "./ConsolidationService.js";
import { EmbeddingService } from "./EmbeddingService.js";
import { AutomationService, type AutomationServiceOptions } from "./AutomationService.js";
import { ExportService } from "./ExportService.js";
import { MemoryQueryService } from "./MemoryQueryService.js";

export interface MemoryServicesOptions {
  rootDir?: string;
  automation?: AutomationServiceOptions;
  embeddingService?: EmbeddingServiceLike;
}

export class MemoryServices {
  readonly queryService: MemoryQueryService;
  readonly consolidationService: ConsolidationService;
  readonly exportService: ExportService;
  readonly automationService: AutomationService | null;
  private readonly embeddingService: EmbeddingServiceLike;

  constructor(
    private readonly repository: Repository,
    private readonly languageModel: LanguageModel,
    private readonly options: MemoryServicesOptions = {},
  ) {
    const rootDir = options.rootDir ?? process.cwd();
    this.embeddingService = options.embeddingService ?? new EmbeddingService();
    this.queryService = new MemoryQueryService(repository, languageModel, rootDir, this.embeddingService);
    this.consolidationService = new ConsolidationService(repository, languageModel, { rootDir });
    this.exportService = new ExportService(repository, rootDir);
    this.automationService = options.automation
      ? new AutomationService(repository, this.consolidationService, options.automation)
      : null;
  }

  async capture(input: CaptureMemoryInput, autoConsolidate = true): Promise<{
    atom: MemoryAtom;
    automation: AutomationTriggerResult | null;
  }> {
    const atom = await captureMemory(this.repository, input, this.embeddingService);
    const automation =
      autoConsolidate && this.automationService ? await this.automationService.maybeTriggerAfterCapture() : null;
    return { atom, automation };
  }

  async query(text: string): Promise<QueryMemoryResult> {
    return this.queryService.query(text);
  }

  async getEntityDetail(entityId: string): Promise<EntityDetail | null> {
    const entity = await this.repository.getEntityById(entityId);
    if (!entity) {
      return null;
    }

    const [atoms, links] = await Promise.all([
      this.repository.listAtomsForEntity(entityId),
      this.repository.listEntityLinksForEntity(entityId),
    ]);

    return { entity, atoms, links };
  }

  async proposeCorrection(targetAtomId: string | null, proposedContent: string, reason?: string): Promise<CorrectionAction> {
    return this.consolidationService.proposeCorrection(targetAtomId, proposedContent, reason);
  }

  async consolidate(): Promise<ConsolidationResult> {
    return this.consolidationService.run();
  }

  async forceEnableConsolidation(): Promise<void> {
    return this.consolidationService.forceEnable();
  }

  async exportData(): Promise<ExportResult> {
    return this.exportService.export();
  }

  async runScheduledAutomation(): Promise<AutomationTriggerResult | null> {
    return this.automationService ? this.automationService.runScheduled() : null;
  }

  async createRequestLog(input: CreateRequestLogInput): Promise<RequestLog> {
    return this.repository.createRequestLog(input);
  }
}
