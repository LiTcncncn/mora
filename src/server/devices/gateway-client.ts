import "server-only";
import { AppError } from "../api/errors";

const gatewayBase = `http://127.0.0.1:${process.env.DEVICE_GATEWAY_PORT ?? "8787"}`;

/** Lab 通过网关的本机控制口操作设备；登记表只由网关写。 */
export async function callGateway<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${gatewayBase}${path}`, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError("PROVIDER_UNAVAILABLE", "硬件网关未启动");
  }
  const body = (await response.json().catch(() => null)) as
    | { ok: true; data: T }
    | { ok: false; error?: string }
    | null;
  if (!response.ok || !body || !body.ok) {
    const message = body && !body.ok && body.error ? body.error : "硬件网关没有接受这个操作";
    throw new AppError(response.status === 409 ? "CONFLICT" : "VALIDATION_ERROR", message);
  }
  return body.data;
}
