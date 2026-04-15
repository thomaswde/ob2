import { AbstractJsonLanguageModel } from "./AbstractJsonLanguageModel.js";

export { extractJsonText, parseJsonResponse, type LlmInvokeOptions as AnthropicInvokeOptions } from "./AbstractJsonLanguageModel.js";

export abstract class AbstractAnthropicLanguageModel extends AbstractJsonLanguageModel {
  protected override providerLabel = "Anthropic";
}
