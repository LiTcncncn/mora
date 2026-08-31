import { randomUUID } from "node:crypto";
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

const createSchema = z.object({
  profileId: z.string().min(1),
  persona: personaSchema.omit({
    id: true,
    profileId: true,
    createdAt: true,
    updatedAt: true,
  }),
});

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const profileId = requireQueryParam(request, "profileId");
    return apiSuccess(await personaRepository.list(profileId));
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(createSchema, await readJsonBody(request));
    const timestamp = new Date().toISOString();
    const created = await personaRepository.create({
      ...body.persona,
      id: `persona-${randomUUID()}`,
      profileId: body.profileId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return apiSuccess(created, 201);
  });
}
