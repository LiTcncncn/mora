import { z } from "zod";
import { providerIdSchema } from "@/domain/common";
import { diagnoseProvider } from "@/server/adapters/diagnostics";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  provider: providerIdSchema,
  modelId: z.string().min(1).max(120),
});

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(bodySchema, await readJsonBody(request));
    return apiSuccess(await diagnoseProvider(body.provider, body.modelId));
  });
}
