import { z } from "zod";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
  requireQueryParam,
} from "@/server/api/response";
import { conversationRepository } from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  profileId: z.string().min(1),
  title: z.string().min(1).max(120),
});

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const profileId = requireQueryParam(request, "profileId");
    const conversations = await conversationRepository.list(profileId);
    return apiSuccess(
      conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length,
      })),
    );
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(createSchema, await readJsonBody(request));
    const created = await conversationRepository.create(
      body.profileId,
      body.title,
    );
    return apiSuccess(created, 201);
  });
}
