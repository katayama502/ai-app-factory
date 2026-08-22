import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, StructuredGenerationRequest } from "./provider.js";

export interface AnthropicProviderOptions {
  /** Falls back to the SDK's own credential resolution (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile) when omitted — see the SDK README, don't hardcode a key. */
  apiKey?: string;
  model?: string;
}

const DEFAULT_MODEL = "claude-opus-5";

/**
 * Uses strict tool use (not `messages.parse` + `zodOutputFormat`) so this
 * provider only depends on plain JSON Schema, not a specific Zod major
 * version matching whatever `zodOutputFormat`'s helper expects — the JSON
 * Schema `@aiappfactory/app-spec` derives (`getAppSpecJsonSchema`) is already
 * exactly what `input_schema` needs. `strict: true` + a forced `tool_choice`
 * guarantees the returned `tool_use.input` structurally matches the schema.
 *
 * NOT exercised against a real Claude API call anywhere in this repo's test
 * suite — there is no `ANTHROPIC_API_KEY` in this development environment
 * (see README's "Try it today" / ROADMAP.md). `specGenerator.ts`'s actual
 * logic is verified against `FakeProvider` instead; this class is the real
 * implementation for whenever a key is available, not yet run for real.
 */
export class AnthropicProvider implements LlmProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: AnthropicProviderOptions = {}) {
    this.client = options.apiKey ? new Anthropic({ apiKey: options.apiKey }) : new Anthropic();
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async generateStructured(request: StructuredGenerationRequest): Promise<unknown> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userPrompt }],
      tools: [
        {
          name: request.toolName,
          description: "Emit the result as structured JSON matching the provided schema. Always call this tool — never respond with plain text.",
          strict: true,
          input_schema: request.jsonSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: request.toolName },
    });

    if (response.stop_reason === "refusal") {
      throw new Error(`model refused: ${response.stop_details?.explanation ?? "no explanation given"}`);
    }

    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    if (!toolUse) {
      throw new Error(`model did not return a "${request.toolName}" tool call (stop_reason: ${response.stop_reason})`);
    }
    return toolUse.input;
  }
}
