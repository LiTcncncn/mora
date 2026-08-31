import { z } from "zod";
import { energyLevelSchema } from "@/domain/common";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";
import { buildContext } from "@/server/context/builder";
import { resolveEnergy } from "@/server/energy/resolver";
import { selectFewShotSamples } from "@/server/fewshot/selector";
import { selectMemories } from "@/server/memory/selector";
import {
  conversationRepository,
  fewShotRepository,
  memoryRepository,
  personaRepository,
  promptPresetRepository,
  settingsRepository,
} from "@/server/persistence/repositories";
import { AppError } from "@/server/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  profileId: z.string().min(1),
  conversationId: z.string().min(1),
  userMessage: z.string().min(1).max(8000),
  modelSlotId: z.string().min(1).optional(),
  energyOverride: energyLevelSchema.optional(),
});

/** 只预览，不创建 run，不更新 Memory 使用次数。 */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(bodySchema, await readJsonBody(request));
    const settings = await settingsRepository.get(body.profileId);

    const slot =
      settings.compare.modelSlots.find(
        (item) => item.id === body.modelSlotId,
      ) ?? settings.compare.modelSlots.find((item) => item.enabled);

    if (!slot) {
      throw new AppError("VALIDATION_ERROR", "没有可用的模型槽位");
    }

    const [persona, promptPreset, memories, fewShotSamples, conversation] =
      await Promise.all([
        personaRepository.get(body.profileId, settings.activePersonaId),
        promptPresetRepository.get(
          body.profileId,
          settings.activePromptPresetId,
        ),
        memoryRepository.list(body.profileId),
        fewShotRepository.list(body.profileId),
        conversationRepository.get(body.profileId, body.conversationId),
      ]);

    const energyResolution = await resolveEnergy({
      userMessage: body.userMessage,
      settings: settings.energy,
      override: body.energyOverride,
      timeoutMs:
        settings.providers[settings.energy.llmClassifier.provider].transport
          .timeoutMs,
    });
    const memorySelection = selectMemories({
      memories,
      userMessage: body.userMessage,
      settings: settings.memory,
    });
    const fewShotSelection = selectFewShotSamples({
      samples: fewShotSamples,
      userMessage: body.userMessage,
      energyLevel: energyResolution.level,
      settings: settings.context.fewShot,
    });

    const snapshot = buildContext({
      modelSlotId: slot.id,
      userMessage: body.userMessage,
      conversation,
      persona,
      energyResolution,
      selectedMemories: memorySelection.selected,
      memoryTrace: memorySelection.trace,
      selectedFewShotSamples: fewShotSelection.selected,
      fewShotTrace: fewShotSelection.trace,
      promptPreset,
      settings: {
        context: settings.context,
        memory: settings.memory,
        energy: settings.energy,
      },
    });

    return apiSuccess({
      slot: { id: slot.id, label: slot.label },
      energy: energyResolution,
      snapshot,
    });
  });
}
