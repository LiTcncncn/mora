import { z } from "zod";
import { energyLevelSchema } from "@/domain/common";
import { generationOverridesSchema } from "@/domain/settings";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";
import { runCompare } from "@/server/orchestration/compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  profileId: z.string().min(1),
  conversationId: z.string().min(1),
  userMessage: z.string().min(1).max(8000),
  energyOverride: energyLevelSchema.optional(),
  slotOverrides: z
    .array(
      z.object({
        modelSlotId: z.string().min(1),
        generation: generationOverridesSchema.optional(),
      }),
    )
    .optional(),
});

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(bodySchema, await readJsonBody(request));
    const result = await runCompare(body);
    return apiSuccess(result);
  });
}
