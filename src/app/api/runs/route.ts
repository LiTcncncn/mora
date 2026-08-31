import { toRunSummary } from "@/domain/run";
import {
  apiSuccess,
  handleRoute,
  requireQueryParam,
} from "@/server/api/response";
import { runRepository } from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 列表只返回摘要，完整 context 只在详情返回。 */
export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const profileId = requireQueryParam(request, "profileId");
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider");
    const mode = url.searchParams.get("mode");
    const status = url.searchParams.get("status");
    const conversationId = url.searchParams.get("conversationId");
    const cursor = Number(url.searchParams.get("cursor") ?? "0");
    const limit = Math.min(
      200,
      Math.max(1, Number(url.searchParams.get("limit") ?? "50")),
    );

    let items = await runRepository.list(profileId);
    if (provider) items = items.filter((run) => run.provider === provider);
    if (mode) items = items.filter((run) => run.mode === mode);
    if (status) items = items.filter((run) => run.status === status);
    if (conversationId) {
      items = items.filter((run) => run.conversationId === conversationId);
    }

    items.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    const offset = Number.isFinite(cursor) && cursor > 0 ? cursor : 0;
    const page = items.slice(offset, offset + limit);

    return apiSuccess({
      total: items.length,
      nextCursor: offset + page.length < items.length ? offset + page.length : null,
      items: page.map(toRunSummary),
    });
  });
}
