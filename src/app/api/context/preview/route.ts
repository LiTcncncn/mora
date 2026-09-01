import { z } from "zod";
import { energyLevelSchema } from "@/domain/common";
import type { Conversation } from "@/domain/conversation";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";
import { buildContext } from "@/server/context/builder";
import { prepareSharedTurnContext } from "@/server/orchestration/prepare-turn";
import {
  conversationRepository,
  memoryRepository,
  personaRepository,
  profileRepository,
  promptPresetRepository,
  settingsRepository,
} from "@/server/persistence/repositories";
import { AppError } from "@/server/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  profileId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  userMessage: z.string().min(1).max(8000),
  modelSlotId: z.string().min(1).optional(),
  energyOverride: energyLevelSchema.optional(),
});

function emptyConversation(profileId: string): Conversation {
  const timestamp = new Date().toISOString();
  return {
    id: "conv-preview-empty",
    profileId,
    title: "预览（不带历史）",
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
  };
}

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

    const conversationId = body.conversationId;
    const [profile, persona, promptPreset, memories, conversation] =
      await Promise.all([
        profileRepository.requireProfile(body.profileId),
        personaRepository.get(body.profileId, settings.activePersonaId),
        promptPresetRepository.get(body.profileId, settings.activePromptPresetId),
        memoryRepository.list(body.profileId),
        conversationId === undefined
          ? Promise.resolve(emptyConversation(body.profileId))
          : conversationRepository.get(body.profileId, conversationId),
      ]);

    const sharedTurn = await prepareSharedTurnContext({
      profileId: body.profileId,
      profileName: profile.name,
      userMessage: body.userMessage,
      conversation,
      modelSlotId: slot.id,
      settings: {
        memory: settings.memory,
        energy: settings.energy,
      },
      memories,
      energyOverride: body.energyOverride,
    });

    const snapshot = buildContext({
      modelSlotId: slot.id,
      userMessage: body.userMessage,
      conversation,
      persona,
      turnPlan: sharedTurn.turnPlan,
      behaviorConfig: sharedTurn.behaviorConfig,
      energyResolution: sharedTurn.energyResolution,
      selectedMemories: sharedTurn.selectedMemories,
      memoryTrace: sharedTurn.memoryTrace,
      promptPreset,
      settings: {
        context: settings.context,
        memory: settings.memory,
      },
    });

    return apiSuccess({
      slot: { id: slot.id, label: slot.label },
      energy: sharedTurn.energyResolution,
      behaviorTrace: sharedTurn.behaviorTrace,
      turnPlan: sharedTurn.turnPlan,
      routing: sharedTurn.routing,
      safety: sharedTurn.safety,
      urgentReply: sharedTurn.urgentReply,
      snapshot: {
        ...snapshot,
        turnRoutingSource: sharedTurn.routing.source,
      },
    });
  });
}
