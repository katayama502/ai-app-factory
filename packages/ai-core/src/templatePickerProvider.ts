import type { AppSpec } from "@aiappfactory/app-spec";
import type { LlmProvider, StructuredGenerationRequest } from "./provider.js";

export interface TemplateCandidate {
  spec: AppSpec;
  /** Case-insensitive substrings to match against the user's description — Japanese and English both welcome. */
  keywords: string[];
}

/**
 * An offline, zero-configuration fallback for when no real LLM API key is set (see
 * `AnthropicProvider`'s own doc comment — this repo has none in CI/dev). Picks
 * whichever already-validated, hand-written template's keywords best match the
 * user's free-text description, and returns it as if it had just been generated.
 *
 * This is NOT real generation — it can only ever return one of the candidates it
 * was constructed with, verbatim, never something novel. But it exercises the
 * exact same validate/self-repair pipeline every other provider does
 * (`generateAppSpec` has no special case for it, and always succeeds on the first
 * attempt here since every candidate is already a valid Spec), so a reader with no
 * API key and no signup can still see the full "describe an app → it gets
 * generated, scored, and published" flow work end to end — just choosing among a
 * fixed menu instead of writing something new.
 */
export class TemplatePickerProvider implements LlmProvider {
  private readonly candidates: readonly TemplateCandidate[];

  constructor(candidates: TemplateCandidate[]) {
    if (candidates.length === 0) throw new Error("TemplatePickerProvider needs at least one candidate template");
    this.candidates = candidates;
  }

  async generateStructured(request: StructuredGenerationRequest): Promise<unknown> {
    const text = request.userPrompt.toLowerCase();
    let best = this.candidates[0] as TemplateCandidate;
    let bestScore = -1;
    for (const candidate of this.candidates) {
      const score = candidate.keywords.reduce((sum, keyword) => sum + (text.includes(keyword.toLowerCase()) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best.spec;
  }
}
