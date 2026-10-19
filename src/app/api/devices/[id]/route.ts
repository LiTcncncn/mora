import { z } from "zod";
import { apiSuccess, handleRoute, parseWith, readJsonBody } from "@/server/api/response";
import { requireAdmin } from "@/server/auth/require-auth";
import { callGateway } from "@/server/devices/gateway-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    displayName: z.string().trim().min(1).max(40).optional(),
    volume: z.number().min(0).max(100).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const actionSchema = z.object({
  action: z.enum(["archive", "provision", "haptic"]),
});

export async function PATCH(request: Request, context: Params): Promise<Response> {
  return handleRoute(async () => {
    await requireAdmin();
    const { id } = await context.params;
    const body = parseWith(patchSchema, await readJsonBody(request));
    const record = await callGateway(`/devices/${encodeURIComponent(id)}`, { method: "PATCH", body });
    return apiSuccess(record);
  });
}

/** 归档当前对话、远程进配网、测试震动。 */
export async function POST(request: Request, context: Params): Promise<Response> {
  return handleRoute(async () => {
    await requireAdmin();
    const { id } = await context.params;
    const { action } = parseWith(actionSchema, await readJsonBody(request));
    const result = await callGateway(`/devices/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    return apiSuccess(result);
  });
}
