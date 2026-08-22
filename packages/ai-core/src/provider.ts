/**
 * Provider abstraction (01_ARCHITECTURE §4: "プロバイダ抽象 OpenAI互換/Anthropic/Google/Ollama").
 * Only the one operation Spec generation actually needs: "given a prompt and a JSON
 * Schema, return an object matching it." No chat history, no tool loop, no streaming —
 * a real multi-turn Builder UI (E2-8) would need more, but generation + self-repair
 * (E2-6/E2-7) is single-shot-per-attempt by design (see specGenerator.ts).
 */
export interface StructuredGenerationRequest {
  systemPrompt: string;
  userPrompt: string;
  /** JSON Schema (draft-7-ish) describing the required output shape. */
  jsonSchema: object;
  /** Name for the underlying tool/function call — provider-specific plumbing, not user-facing. */
  toolName: string;
}

export interface LlmProvider {
  generateStructured(request: StructuredGenerationRequest): Promise<unknown>;
}
