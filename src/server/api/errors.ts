export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_AUTH_ERROR",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_BAD_REQUEST",
  "PROVIDER_UNAVAILABLE",
  "EMPTY_MODEL_OUTPUT",
  "DATA_READ_ERROR",
  "DATA_VALIDATION_ERROR",
  "DATA_WRITE_ERROR",
  "CONTEXT_BUDGET_EXCEEDED",
  "CONTEXT_HASH_MISMATCH",
  "COMPARISON_ALREADY_SELECTED",
  "UNKNOWN_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly fieldErrors?: Record<string, string[]>;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      httpStatus?: number;
      fieldErrors?: Record<string, string[]>;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? defaultStatusForCode(code);
    this.fieldErrors = options.fieldErrors;
    this.retryable = options.retryable ?? defaultRetryableForCode(code);
  }
}

export function defaultStatusForCode(code: ErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "COMPARISON_ALREADY_SELECTED":
      return 409;
    case "PROVIDER_NOT_CONFIGURED":
      return 400;
    case "PROVIDER_AUTH_ERROR":
      return 502;
    case "PROVIDER_RATE_LIMITED":
      return 429;
    case "PROVIDER_TIMEOUT":
      return 504;
    case "PROVIDER_BAD_REQUEST":
      return 502;
    case "PROVIDER_UNAVAILABLE":
      return 502;
    case "EMPTY_MODEL_OUTPUT":
      return 502;
    case "CONTEXT_BUDGET_EXCEEDED":
      return 400;
    case "CONTEXT_HASH_MISMATCH":
      return 409;
    case "DATA_READ_ERROR":
    case "DATA_VALIDATION_ERROR":
    case "DATA_WRITE_ERROR":
      return 500;
    default:
      return 500;
  }
}

export function defaultRetryableForCode(code: ErrorCode): boolean {
  return (
    code === "PROVIDER_RATE_LIMITED" ||
    code === "PROVIDER_TIMEOUT" ||
    code === "PROVIDER_UNAVAILABLE"
  );
}

export const ERROR_MESSAGES_ZH: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "请求参数不合法",
  NOT_FOUND: "找不到对应数据",
  CONFLICT: "当前状态无法完成该操作",
  PROVIDER_NOT_CONFIGURED: "该供应商尚未配置 API Key",
  PROVIDER_AUTH_ERROR: "供应商认证失败",
  PROVIDER_RATE_LIMITED: "供应商限流",
  PROVIDER_TIMEOUT: "供应商请求超时",
  PROVIDER_BAD_REQUEST: "供应商拒绝了该请求参数",
  PROVIDER_UNAVAILABLE: "供应商暂时不可用",
  EMPTY_MODEL_OUTPUT: "模型返回了空内容",
  DATA_READ_ERROR: "本地数据读取失败",
  DATA_VALIDATION_ERROR: "本地数据校验失败",
  DATA_WRITE_ERROR: "本地数据写入失败",
  CONTEXT_BUDGET_EXCEEDED: "上下文超出预算且无法安全裁剪",
  CONTEXT_HASH_MISMATCH: "上下文快照不一致",
  COMPARISON_ALREADY_SELECTED: "该比较组已被处理",
  UNKNOWN_ERROR: "发生未知错误",
};
