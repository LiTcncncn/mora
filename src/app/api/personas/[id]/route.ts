import { z } from "zod";
import { personaSchema } from "@/domain/persona";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
  requireQueryParam,
} from "@/server/api/response";
import { personaRepository } from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  profileId: z.string().min(1),
  persona: personaSchema,
});

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    const profileId = requireQueryParam(request, "profileId");
    return apiSuccess(await personaRepository.get(profileId, id));
  });
}

export async function PUT(request: Request, context: Params): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    const body = parseWith(updateSchema, await readJsonBody(request));
    const updated = await personaRepository.update(
      body.profileId,
      id,
      body.persona,
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
    await personaRepository.remove(profileId, id);
    return apiSuccess({ id });
  });
}
