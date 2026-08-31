import { z } from "zod";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";
import { selectMemories } from "@/server/memory/selector";
import {
  memoryRepository,
  settingsRepository,
} from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  profileId: z.string().min(1),
  userMessage: z.string().max(8000),
});

/** 只读预览：不更新 lastUsedAt / useCount，不产生任何写副作用。 */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(bodySchema, await readJsonBody(request));
    const [memories, settings] = await Promise.all([
      memoryRepository.list(body.profileId),
      settingsRepository.get(body.profileId),
    ]);

    const result = selectMemories({
      memories,
      userMessage: body.userMessage,
      settings: settings.memory,
    });

    return apiSuccess({
      selectedIds: result.selected.map((memory) => memory.id),
      trace: result.trace,
    });
  });
}
