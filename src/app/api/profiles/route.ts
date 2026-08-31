import { z } from "zod";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";
import { profileRepository } from "@/server/persistence/repositories";
import { ensureBootstrapped } from "@/server/persistence/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({ name: z.string().min(1).max(80) });

export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    await ensureBootstrapped();
    return apiSuccess(await profileRepository.list());
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    await ensureBootstrapped();
    const body = parseWith(createSchema, await readJsonBody(request));
    const profile = await profileRepository.create(body.name);
    return apiSuccess(profile, 201);
  });
}
