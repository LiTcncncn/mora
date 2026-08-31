import { AppError, type ErrorCode } from "../api/errors";
import { getSecretValues } from "../config/env";
import { sanitizeText } from "../observability/sanitize";

/**
 * 将供应商错误映射为安全、短小的结构化错误。
 * 绝不返回 header、请求对象、stack 或原始响应。
 */
export function mapProviderError(
  provider: string,
  status: number | null,
  rawMessage: string,
): AppError {
  const message = sanitizeText(rawMessage, getSecretValues()).slice(0, 300);

  let code: ErrorCode = "PROVIDER_UNAVAILABLE";
  if (status === 401 || status === 403) code = "PROVIDER_AUTH_ERROR";
  else if (status === 429) code = "PROVIDER_RATE_LIMITED";
  else if (
    status === 408 ||
    status === 504 ||
    /timed? ?out|aborted|etimedout|econnreset|connect.?timeout/i.test(message)
  ) {
    code = "PROVIDER_TIMEOUT";
  } else if (status !== null && status >= 400 && status < 500)
    code = "PROVIDER_BAD_REQUEST";

  return new AppError(code, `${provider} 调用失败：${message}`);
}

export function isRetryable(error: unknown): boolean {
  return error instanceof AppError && error.retryable;
}

export class ProviderTimeoutError extends AppError {
  constructor(provider: string, timeoutMs: number) {
    super("PROVIDER_TIMEOUT", `${provider} 调用超时（${timeoutMs}ms）`);
  }
}

/**
 * 有限重试；重试耗尽后直接抛出失败。
 * 绝不调用 fallback adapter，也绝不生成任何本地保底文本。
 */
export async function withRetries<T>(
  maxRetries: number,
  task: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === maxRetries) break;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}
