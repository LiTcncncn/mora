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

const updateSchema = z.object({
  profileId: z.string().min(1),
  title: z.string().min(1).max(120),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    const profileId = requireQueryParam(request, "profileId");
    return apiSuccess(await conversationRepository.get(profileId, id));
  });
}

export async function PUT(request: Request, context: Params): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    const body = parseWith(updateSchema, await readJsonBody(request));
    const updated = await conversationRepository.rename(
      body.profileId,
      id,
      body.title,
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
    // 不级联删除 runs：runs 保留快照，Inspector 中显示原对话已删除。
    await conversationRepository.remove(profileId, id);
    return apiSuccess({ id });
  });
}
