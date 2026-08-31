import { getProviderConfiguredStatus } from "@/server/config/env";
import { apiSuccess, handleRoute } from "@/server/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return handleRoute(async () => apiSuccess(getProviderConfiguredStatus()));
}
