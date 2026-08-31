import { z } from "zod";
import { CALL_FAILED_TEXT } from "@/domain/common";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";
import {
  extractMemoryCandidates,
  priorContextBeforeUserMessage,
  userTextsFromIds,
} from "@/server/memory/candidate-extractor";
import {
  conversationRepository,
  memoryRepository,
  settingsRepository,
} from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  profileId: z.string().min(1),
  conversationId: z.string().min(1),
  messageIds: z.array(z.string().min(1)).min(1).max(20),
});

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(bodySchema, await readJsonBody(request));
    const [conversation, settings] = await Promise.all([
      conversationRepository.get(body.profileId, body.conversationId),
      settingsRepository.get(body.profileId),
    ]);

    const userTexts = userTextsFromIds(conversation.messages, body.messageIds);

    if (userTexts.length === 0) {
      return apiSuccess({ status: "succeeded" as const, candidates: [], displayText: "" });
    }

    const focusId = userTexts[userTexts.length - 1]!.messageId;
    const provider = settings.memory.autoCandidateExtraction.provider;

    try {
      const candidates = await extractMemoryCandidates({
        profileId: body.profileId,
        conversationId: body.conversationId,
        userTexts,
        priorContext: priorContextBeforeUserMessage(
          conversation.messages,
          focusId,
        ),
        memorySettings: settings.memory,
        timeoutMs: settings.providers[provider].transport.timeoutMs,
      });
      await memoryRepository.createMany(candidates);
      return apiSuccess({
        status: "succeeded" as const,
        candidates,
        displayText: "",
      });
    } catch {
      // 失败只如实报告，不生成任何预设候选。
      return apiSuccess({
        status: "failed" as const,
        candidates: [],
        displayText: CALL_FAILED_TEXT,
      });
    }
  });
}
