import { z } from "zod";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
  requireQueryParam,
} from "@/server/api/response";
import { requireAdmin } from "@/server/auth/require-auth";
import { conversationRepository } from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  profileId: z.string().min(1),
  title: z.string().min(1).max(120),
});

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    await requireAdmin();
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
    await requireAdmin();
    const body = parseWith(createSchema, await readJsonBody(request));
    const created = await conversationRepository.create(
      body.profileId,
      body.title,
    );
    return apiSuccess(created, 201);
  });
}

/** 删除当前配置槽下全部对话；不级联删除 runs。 */
export async function DELETE(request: Request): Promise<Response> {
  return handleRoute(async () => {
    await requireAdmin();
    const profileId = requireQueryParam(request, "profileId");
    const result = await conversationRepository.removeAll(profileId);
    return apiSuccess(result);
  });
}
