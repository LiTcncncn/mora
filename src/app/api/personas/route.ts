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
import { requireAdmin, requireAuth } from "@/server/auth/require-auth";
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
    await requireAuth();
    const profileId = requireQueryParam(request, "profileId");
    return apiSuccess(await personaRepository.list(profileId));
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    await requireAdmin();
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
