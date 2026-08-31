import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError, ERROR_MESSAGES_ZH, type ErrorCode } from "./errors";
import { getSecretValues } from "../config/env";
import { sanitizeText } from "../observability/sanitize";

export type ApiResponse<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: ErrorCode;
        message: string;
        fieldErrors?: Record<string, string[]>;
      };
    };

export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json<ApiResponse<T>>({ ok: true, data }, { status });
}

export function apiFailure(
  code: ErrorCode,
  message: string,
  options: { status?: number; fieldErrors?: Record<string, string[]> } = {},
): NextResponse {
  const error = new AppError(code, message, {
    httpStatus: options.status,
    fieldErrors: options.fieldErrors,
  });
  return errorResponse(error);
}

function errorResponse(error: AppError): NextResponse {
  const secrets = getSecretValues();
  return NextResponse.json<ApiResponse<never>>(
    {
      ok: false,
      error: {
        code: error.code,
        message: sanitizeText(error.message, secrets),
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      },
    },
    { status: error.httpStatus },
  );
}

export function zodFieldErrors(error: ZodError): Record<string, string[]> {
  const output: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_root";
    const list = output[key] ?? [];
    list.push(issue.message);
    output[key] = list;
  }
  return output;
}

/** 统一包装 Route Handler，永不返回 stack trace 或密钥。 */
export async function handleRoute(
  handler: () => Promise<Response>,
): Promise<Response> {
  try {
    return await handler();
  } catch (caught) {
    if (caught instanceof AppError) {
      return errorResponse(caught);
    }
    if (caught instanceof ZodError) {
      return errorResponse(
        new AppError("VALIDATION_ERROR", ERROR_MESSAGES_ZH.VALIDATION_ERROR, {
          fieldErrors: zodFieldErrors(caught),
        }),
      );
    }
    const message =
      caught instanceof Error ? caught.message : ERROR_MESSAGES_ZH.UNKNOWN_ERROR;
    if (process.env.NODE_ENV !== "test") {
      console.error(
        "[mora] unhandled route error:",
        sanitizeText(message, getSecretValues()),
      );
    }
    return errorResponse(new AppError("UNKNOWN_ERROR", message));
  }
}

export function parseWith<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", ERROR_MESSAGES_ZH.VALIDATION_ERROR, {
      fieldErrors: zodFieldErrors(result.error),
    });
  }
  return result.data;
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "请求体不是合法 JSON");
  }
}

export function requireQueryParam(request: Request, name: string): string {
  const value = new URL(request.url).searchParams.get(name);
  if (!value) {
    throw new AppError("VALIDATION_ERROR", `缺少查询参数 ${name}`, {
      fieldErrors: { [name]: ["必填"] },
    });
  }
  return value;
}
