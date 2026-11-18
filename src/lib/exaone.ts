/**
 * LG K-EXAONE 2.5 클라이언트 (OpenAI 호환 Chat Completions API)
 * 문서: https://docs.exaone.ai
 */

export const EXAONE_MODEL = process.env.EXAONE_MODEL || "k-exaone_v2.5";
const EXAONE_BASE_URL = (
  process.env.EXAONE_BASE_URL || "https://api.exaone.ai/v1"
).replace(/\/+$/, "");

export type ExaoneReasoningEffort = "low" | "medium" | "high" | "max";

export interface ExaoneOptions {
  /** 추론 강도. 높을수록 정확하지만 느리고 토큰을 더 씁니다. */
  reasoningEffort?: ExaoneReasoningEffort;
  /** 추론 토큰 + 답변 토큰 합산 상한 */
  maxTokens?: number;
  temperature?: number;
  /** 요청 타임아웃(ms). 초과 시 오류로 처리되어 Gemini로 전환됩니다. */
  timeoutMs?: number;
}

export class ExaoneError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ExaoneError";
    this.status = status;
  }
}

interface ExaoneChatResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null; reasoning_content?: string | null };
  }>;
}

export function isExaoneConfigured(): boolean {
  const key = process.env.EXAONE_API_KEY;
  return Boolean(key && key !== "your_exaone_api_key");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOnce(prompt: string, opts: ExaoneOptions): Promise<string> {
  const res = await fetch(`${EXAONE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.EXAONE_API_KEY}`,
    },
    body: JSON.stringify({
      model: EXAONE_MODEL,
      messages: [{ role: "user", content: prompt }],
      reasoning_effort: opts.reasoningEffort ?? "medium",
      max_tokens: opts.maxTokens ?? 16384,
      temperature: opts.temperature ?? 0.6,
      top_p: 0.95,
      stream: false,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ExaoneError(
      `K-EXAONE API 오류 (${res.status}): ${body.slice(0, 300)}`,
      res.status
    );
  }

  const data = (await res.json()) as ExaoneChatResponse;
  const choice = data.choices?.[0];
  const text = (choice?.message?.content || "").trim();

  if (!text) {
    // 추론 토큰이 max_tokens를 모두 소진하면 content가 비어서 돌아옵니다.
    throw new ExaoneError(
      `K-EXAONE 응답 본문이 비어 있습니다 (finish_reason: ${choice?.finish_reason ?? "unknown"}).`
    );
  }
  return text;
}

/**
 * K-EXAONE 호출. 429/5xx 일시 오류는 1회 재시도하고, 그래도 실패하면 throw하여
 * 상위(llm.ts)에서 Gemini로 전환하게 합니다.
 */
export async function generateWithExaone(
  prompt: string,
  opts: ExaoneOptions = {}
): Promise<string> {
  if (!isExaoneConfigured()) {
    throw new ExaoneError("EXAONE_API_KEY 환경변수가 설정되지 않았습니다.");
  }

  try {
    return await callOnce(prompt, opts);
  } catch (err) {
    const status = (err as ExaoneError).status;
    const retryable = status === 429 || (status !== undefined && status >= 500);
    if (!retryable) throw err;
    await sleep(1000 + Math.floor(Math.random() * 300));
    return callOnce(prompt, opts);
  }
}
