import { getProviderConfiguredStatus } from "@/server/config/env";
import { apiSuccess, handleRoute } from "@/server/api/response";
import { requireAuth } from "@/server/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    await requireAuth();
    return apiSuccess(getProviderConfiguredStatus());
  });
}
