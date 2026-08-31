import { randomUUID } from "node:crypto";
import { z } from "zod";
import { memoryItemSchema, memoryStatusSchema, memoryTypeSchema } from "@/domain/memory";
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

const createSchema = z.object({
  profileId: z.string().min(1),
  memory: memoryItemSchema.omit({
    id: true,
    profileId: true,
    createdAt: true,
    updatedAt: true,
    lastUsedAt: true,
    useCount: true,
  }),
});

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const profileId = requireQueryParam(request, "profileId");
    const url = new URL(request.url);
    const query = url.searchParams.get("query")?.trim().toLowerCase() ?? "";
    const type = url.searchParams.get("type");
    const status = url.searchParams.get("status");
    const enabled = url.searchParams.get("enabled");

    let items = await memoryRepository.list(profileId);
    if (query) {
      items = items.filter(
        (item) =>
          item.content.toLowerCase().includes(query) ||
          item.tags.some((tag) => tag.toLowerCase().includes(query)),
      );
    }
    if (type && memoryTypeSchema.safeParse(type).success) {
      items = items.filter((item) => item.type === type);
    }
    if (status && memoryStatusSchema.safeParse(status).success) {
      items = items.filter((item) => item.status === status);
    }
    if (enabled === "true" || enabled === "false") {
      items = items.filter((item) => item.enabled === (enabled === "true"));
    }
    return apiSuccess(items);
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(createSchema, await readJsonBody(request));
    const timestamp = new Date().toISOString();
    const created = await memoryRepository.create({
      ...body.memory,
      id: `mem-${randomUUID()}`,
      profileId: body.profileId,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUsedAt: null,
      useCount: 0,
    });
    return apiSuccess(created, 201);
  });
}
