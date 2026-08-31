import { z } from "zod";
import { settingsDataSchema } from "@/domain/settings";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
  requireQueryParam,
} from "@/server/api/response";
import { ensureBootstrapped } from "@/server/persistence/bootstrap";
import { settingsRepository } from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const putSchema = z.object({
  profileId: z.string().min(1),
  settings: settingsDataSchema,
});

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    await ensureBootstrapped();
    const profileId = requireQueryParam(request, "profileId");
    return apiSuccess(await settingsRepository.get(profileId));
  });
}

export async function PUT(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(putSchema, await readJsonBody(request));
    const saved = await settingsRepository.save(body.profileId, body.settings);
    return apiSuccess(saved);
  });
}
