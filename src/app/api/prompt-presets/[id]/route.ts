import { z } from "zod";
import { promptPresetSchema } from "@/domain/prompt";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
  requireQueryParam,
} from "@/server/api/response";
import { promptPresetRepository } from "@/server/persistence/repositories";
import { assertTemplatesValid } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  profileId: z.string().min(1),
  preset: promptPresetSchema,
});

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    const profileId = requireQueryParam(request, "profileId");
    return apiSuccess(await promptPresetRepository.get(profileId, id));
  });
}

export async function PUT(request: Request, context: Params): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    const body = parseWith(updateSchema, await readJsonBody(request));
    assertTemplatesValid(body.preset.sections);
    const updated = await promptPresetRepository.update(
      body.profileId,
      id,
      body.preset,
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
    await promptPresetRepository.remove(profileId, id);
    return apiSuccess({ id });
  });
}
