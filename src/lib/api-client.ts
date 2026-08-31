export interface ApiError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(error: ApiError) {
    super(error.message);
    this.name = "ApiRequestError";
    this.code = error.code;
    this.fieldErrors = error.fieldErrors;
  }
}

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: ApiError };

async function request<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });

  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!payload.ok) throw new ApiRequestError(payload.error);
  return payload.data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, json?: unknown) =>
    request<T>(path, { method: "POST", json }),
  put: <T>(path: string, json?: unknown) =>
    request<T>(path, { method: "PUT", json }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return "发生未知错误";
}
