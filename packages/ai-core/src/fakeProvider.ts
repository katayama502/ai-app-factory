import type { LlmProvider, StructuredGenerationRequest } from "./provider.js";

/**
 * A scripted provider for tests: returns queued responses in order (or calls a
 * function for dynamic/stateful behavior), so the self-repair loop in
 * `specGenerator.ts` can be tested deterministically without a real model —
 * this repo has no `ANTHROPIC_API_KEY` available in CI/dev to exercise
 * `AnthropicProvider` for real yet (see README's "Try it today").
 */
export class FakeProvider implements LlmProvider {
  private readonly responses: unknown[];
  private readonly calls: StructuredGenerationRequest[] = [];
  private index = 0;

  constructor(responses: unknown[]) {
    this.responses = responses;
  }

  async generateStructured(request: StructuredGenerationRequest): Promise<unknown> {
    this.calls.push(request);
    if (this.index >= this.responses.length) {
      throw new Error(`FakeProvider: no more queued responses (called ${this.index + 1} times)`);
    }
    return this.responses[this.index++];
  }

  /** Prompts sent so far, in order — for asserting the repair prompt actually includes prior errors. */
  callHistory(): readonly StructuredGenerationRequest[] {
    return this.calls;
  }

  callCount(): number {
    return this.calls.length;
  }
}
