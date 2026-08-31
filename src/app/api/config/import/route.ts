import { z } from "zod";
import { moraConfigBundleSchema } from "@/domain/config-bundle";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";
import { importConfigBundle, summarizeBundle } from "@/server/config/bundle";
import {
  fewShotRepository,
  personaRepository,
  promptPresetRepository,
} from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  profileId: z.string().min(1),
  bundle: moraConfigBundleSchema,
  confirmed: z.boolean(),
});

/** 服务端重新完整校验，不信任浏览器端校验结果。 */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(bodySchema, await readJsonBody(request));

    const [personas, presets, fewShotSamples] = await Promise.all([
      personaRepository.list(body.profileId),
      promptPresetRepository.list(body.profileId),
      fewShotRepository.list(body.profileId),
    ]);

    const summary = summarizeBundle(body.bundle, {
      personaCount: personas.length,
      promptPresetCount: presets.length,
      fewShotSampleCount: fewShotSamples.length,
    });

    if (!body.confirmed) {
      return apiSuccess({ applied: false, summary });
    }

    const settings = await importConfigBundle(body.profileId, body.bundle);
    return apiSuccess({ applied: true, summary, settings });
  });
}
