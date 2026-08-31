import { z } from "zod";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";
import { profileRepository } from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  setActive: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Params): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    const body = parseWith(updateSchema, await readJsonBody(request));

    if (body.name !== undefined) {
      await profileRepository.rename(id, body.name);
    }
    if (body.setActive) {
      await profileRepository.setActive(id);
    }
    return apiSuccess(await profileRepository.list());
  });
}

export async function DELETE(
  _request: Request,
  context: Params,
): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    await profileRepository.remove(id);
    return apiSuccess(await profileRepository.list());
  });
}
