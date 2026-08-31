import { z } from "zod";
import { memoryItemSchema } from "@/domain/memory";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
  requireQueryParam,
} from "@/server/api/response";
import { memoryRepository } from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  profileId: z.string().min(1),
  memory: memoryItemSchema,
});

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Params): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    const body = parseWith(updateSchema, await readJsonBody(request));
    const updated = await memoryRepository.update(
      body.profileId,
      id,
      body.memory,
    );
    return apiSuccess(updated);
  });
}

export async function DELETE(
  request: Request,
  context: Params,
): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    const profileId = requireQueryParam(request, "profileId");
    await memoryRepository.remove(profileId, id);
    return apiSuccess({ id });
  });
}
