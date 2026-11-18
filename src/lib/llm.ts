import {
  EXAONE_MODEL,
  ExaoneOptions,
  generateWithExaone,
  isExaoneConfigured,
} from "@/lib/exaone";
import { generateContentWithFallback } from "@/lib/gemini";

export type LlmProvider = "exaone" | "gemini";

export interface LlmResult {
  text: string;
  provider: LlmProvider;
  modelUsed: string;
  /** EXAONE 호출이 실패해 Gemini로 전환된 경우 그 사유 */
  exaoneError?: string;
}

/**
 * 1순위 K-EXAONE 2.5 → 실패 시 Gemini Fallback Chain으로 자동 전환
 * (EXAONE_API_KEY가 없으면 바로 Gemini를 사용)
 */
export async function generateText(
  prompt: string,
  exaoneOpts: ExaoneOptions = {}
): Promise<LlmResult> {
  let exaoneError: string | undefined;

  if (isExaoneConfigured()) {
    try {
      const text = await generateWithExaone(prompt, exaoneOpts);
      return { text, provider: "exaone", modelUsed: EXAONE_MODEL };
    } catch (err) {
      exaoneError = err instanceof Error ? err.message : String(err);
      console.warn(`[llm] K-EXAONE 실패, Gemini로 전환합니다: ${exaoneError}`);
    }
  }

  const res = await generateContentWithFallback(prompt);
  return {
    text: res.text,
    provider: "gemini",
    modelUsed: res.modelUsed,
    exaoneError,
  };
}
