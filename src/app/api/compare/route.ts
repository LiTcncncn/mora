import { z } from "zod";
import { energyLevelSchema } from "@/domain/common";
import { conversationMessageSchema } from "@/domain/conversation";
import { memoryItemSchema } from "@/domain/memory";
import { generationOverridesSchema } from "@/domain/settings";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";
import { requireAuth } from "@/server/auth/require-auth";
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
  clientPersist: z.boolean().optional(),
  clientMessages: z.array(conversationMessageSchema).max(200).optional(),
  clientMemories: z.array(memoryItemSchema).max(200).optional(),
});

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const user = await requireAuth();
    const body = parseWith(bodySchema, await readJsonBody(request));
    const clientPersist = user.role === "guest" ? true : Boolean(body.clientPersist);
    const result = await runCompare({
      ...body,
      clientPersist,
      forceAutoMemoryWrite: user.role === "guest",
      actor: { userId: user.id, role: user.role },
      ...(clientPersist
        ? {
            clientMessages: body.clientMessages ?? [],
            clientMemories: body.clientMemories ?? [],
          }
        : {}),
    });
    return apiSuccess(result);
  });
}
