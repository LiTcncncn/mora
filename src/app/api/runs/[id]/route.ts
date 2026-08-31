import {
  apiSuccess,
  handleRoute,
  requireQueryParam,
} from "@/server/api/response";
import { runRepository } from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Params): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    const profileId = requireQueryParam(request, "profileId");
    const run = await runRepository.get(profileId, id);
    const siblings = (
      await Promise.all(
        run.comparisonRunIds.map(async (siblingId) => {
          try {
            return await runRepository.get(profileId, siblingId);
          } catch {
            return null;
          }
        }),
      )
    ).filter((item): item is NonNullable<typeof item> => item !== null);

    return apiSuccess({
      run,
      comparisonRuns: siblings.map((sibling) => ({
        id: sibling.id,
        slotLabel: sibling.slotLabel,
        provider: sibling.provider,
        modelId: sibling.modelId,
        status: sibling.status,
        contextHash: sibling.contextHash,
      })),
    });
  });
}

export async function DELETE(
  request: Request,
  context: Params,
): Promise<Response> {
  return handleRoute(async () => {
    const { id } = await context.params;
    const profileId = requireQueryParam(request, "profileId");
    await runRepository.remove(profileId, id);
    return apiSuccess({ id });
  });
}
