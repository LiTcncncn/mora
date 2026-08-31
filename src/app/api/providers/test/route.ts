import { z } from "zod";
import { providerIdSchema } from "@/domain/common";
import { getAdapter } from "@/server/adapters/registry";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  provider: providerIdSchema,
  modelId: z.string().min(1).max(120),
});

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(bodySchema, await readJsonBody(request));
    const result = await getAdapter(body.provider).testConnection(body.modelId);
    return apiSuccess(result);
  });
}
