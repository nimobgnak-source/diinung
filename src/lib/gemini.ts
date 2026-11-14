import { GoogleGenAI } from "@google/genai";

export const GEMINI_MODEL = "gemini-3.8-flash";
export const GEMINI_FALLBACK_CHAIN = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
] as const;

let aiClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "your_gemini_api_key") {
      throw new Error(
        "GEMINI_API_KEY 환경변수가 설정되지 않았습니다. .env.local 파일을 확인해 주세요."
      );
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatusError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;
  return (
    status === 503 ||
    status === 429 ||
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("high demand") ||
    msg.includes("overloaded")
  );
}

function isFallbackEligibleError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;
  return (
    isRetryableStatusError(err) ||
    status === 404 ||
    msg.includes("404") ||
    msg.includes("NOT_FOUND")
  );
}

/**
 * 1) 503 / 429 오류 발생 시 1초, 2초 간격(랜덤 지터 포함)으로 최대 2회 자동 재시도(Exponential Backoff)
 * 2) 기본 모델(gemini-3.8-flash) 실패 시 gemini-3.5-flash-lite -> gemini-2.5-flash 순서로 자동 전환(Fallback Chain)
 */
export async function generateContentWithFallback(
  contents: string
): Promise<{ text: string; modelUsed: string }> {
  const ai = getGeminiClient();
  let lastError: unknown = null;

  for (const model of GEMINI_FALLBACK_CHAIN) {
    const maxRetries = 2; // 최초 1회 + 재시도 최대 2회 (1초, 2초 backoff)

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents,
        });
        return {
          text: res.text || "",
          modelUsed: model,
        };
      } catch (err) {
        lastError = err;

        // 503 또는 429 과부하 오류인 경우 1초, 2초 간격(+랜덤 지터 0~300ms)으로 재시도
        if (isRetryableStatusError(err) && attempt < maxRetries) {
          const baseDelayMs = attempt === 0 ? 1000 : 2000;
          const jitterMs = Math.floor(Math.random() * 300);
          await sleep(baseDelayMs + jitterMs);
          continue;
        }

        // 재시도 소진 또는 모델 전환 대상 오류 시 다음 Fallback 모델로 즉시 전환
        if (isFallbackEligibleError(err)) {
          break;
        }

        // 인증 오류 등 비일시적 오류는 즉시 throw
        throw err;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini API 모델 호출에 모두 실패했습니다.");
}
