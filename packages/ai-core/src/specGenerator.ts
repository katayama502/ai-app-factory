import { type AppSpec, type ValidationIssue, getAppSpecJsonSchema, validateAppSpec } from "@aiappfactory/app-spec";
import type { LlmProvider } from "./provider.js";
import { SYSTEM_PROMPT, buildInitialPrompt, buildRepairPrompt } from "./prompt.js";

const TOOL_NAME = "emit_app_spec";
const DEFAULT_MAX_ATTEMPTS = 3; // 04_IMPLEMENTATION E2-7: "検証エラー → 再生成、最大3回"

export interface GenerateAppSpecOptions {
  maxAttempts?: number;
}

export type GenerateAppSpecResult =
  | { ok: true; spec: AppSpec; specHash: string; attempts: number }
  | { ok: false; issues: ValidationIssue[]; attempts: number; lastAttempt: unknown };

/**
 * Natural language → App Spec, with a validate/self-repair loop
 * (04_IMPLEMENTATION E2-6/E2-7). The model's output is NEVER trusted directly —
 * every attempt goes through the exact same `validateAppSpec` a hand-written
 * Spec does (this is Gate 0, see `@aiappfactory/security-gate`), and a failed
 * attempt's issues are fed back verbatim for the next try. After
 * `maxAttempts` failed attempts, this returns the last set of issues rather
 * than looping forever or silently accepting something invalid.
 */
export async function generateAppSpec(
  description: string,
  provider: LlmProvider,
  options: GenerateAppSpecOptions = {}
): Promise<GenerateAppSpecResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const jsonSchema = getAppSpecJsonSchema();

  let lastIssues: ValidationIssue[] = [];
  let lastAttempt: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const userPrompt = attempt === 1 ? buildInitialPrompt(description) : buildRepairPrompt(description, lastAttempt, lastIssues);

    const raw = await provider.generateStructured({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      jsonSchema,
      toolName: TOOL_NAME,
    });
    lastAttempt = raw;

    const result = validateAppSpec(raw);
    if (result.ok) {
      return { ok: true, spec: result.spec, specHash: result.specHash, attempts: attempt };
    }
    lastIssues = result.issues;
  }

  return { ok: false, issues: lastIssues, attempts: maxAttempts, lastAttempt };
}
