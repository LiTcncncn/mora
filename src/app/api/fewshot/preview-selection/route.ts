import { z } from "zod";
import { energyLevelSchema } from "@/domain/common";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";
import { selectFewShotSamples } from "@/server/fewshot/selector";
import {
  fewShotRepository,
  settingsRepository,
} from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  profileId: z.string().min(1),
  userMessage: z.string().max(8000),
  energyLevel: energyLevelSchema,
});

/** 只读预览：不写入任何数据。 */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(bodySchema, await readJsonBody(request));
    const [samples, settings] = await Promise.all([
      fewShotRepository.list(body.profileId),
      settingsRepository.get(body.profileId),
    ]);

    const result = selectFewShotSamples({
      samples,
      userMessage: body.userMessage,
      energyLevel: body.energyLevel,
      settings: settings.context.fewShot,
    });

    return apiSuccess({
      selectedIds: result.selected.map((sample) => sample.id),
      trace: result.trace,
    });
  });
}
