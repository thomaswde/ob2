import type { LanguageModel } from "../domain/languageModel.js";
import type { Repository } from "../domain/repository.js";
import type { QueryMemoryResult } from "../domain/types.js";
import { MemoryQueryService } from "./MemoryQueryService.js";

export async function queryMemory(
  repository: Repository,
  languageModel: LanguageModel,
  text: string,
): Promise<QueryMemoryResult> {
  const service = new MemoryQueryService(repository, languageModel);
  return service.query(text);
}
