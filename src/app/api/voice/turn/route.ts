import { z } from "zod";
import { conversationMessageSchema } from "@/domain/conversation";
import { memoryItemSchema } from "@/domain/memory";
import { voiceIdSchema, type VoiceTurnEvent } from "@/domain/voice";
import { AppError } from "@/server/api/errors";
import { handleRoute, parseWith } from "@/server/api/response";
import { requireAuth } from "@/server/auth/require-auth";
import { runVoiceTurn, voiceErrorEvent } from "@/server/orchestration/voice-turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 60 秒 16kHz 单声道 PCM16 约 1.9MB，留出余量。 */
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

const metaSchema = z.object({
  profileId: z.string().min(1),
  conversationId: z.string().min(1),
  modelSlotId: z.string().min(1),
  voiceId: voiceIdSchema,
  clientMessages: z.array(conversationMessageSchema).max(200).optional(),
  clientMemories: z.array(memoryItemSchema).max(200).optional(),
});

async function readWav(form: FormData): Promise<Blob> {
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    throw new AppError("VALIDATION_ERROR", "缺少音频");
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    throw new AppError("VALIDATION_ERROR", "单轮语音过长");
  }
  const header = new Uint8Array(await audio.slice(0, 12).arrayBuffer());
  const tag = (start: number) => String.fromCharCode(...header.slice(start, start + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new AppError("VALIDATION_ERROR", "音频必须是 WAV");
  }
  return new Blob([await audio.arrayBuffer()], { type: "audio/wav" });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const user = await requireAuth();
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError("VALIDATION_ERROR", "请求体不是合法表单");
    }
    let rawMeta: unknown;
    try {
      rawMeta = JSON.parse(String(form.get("meta") ?? ""));
    } catch {
      throw new AppError("VALIDATION_ERROR", "meta 不是合法 JSON");
    }
    const meta = parseWith(metaSchema, rawMeta);
    const audio = await readWav(form);
    const clientPersist = user.role === "guest";

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: VoiceTurnEvent): void => {
          if (request.signal.aborted) return;
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        try {
          await runVoiceTurn(
            {
              profileId: meta.profileId,
              conversationId: meta.conversationId,
              modelSlotId: meta.modelSlotId,
              voiceId: meta.voiceId,
              audio,
              clientPersist,
              clientMessages: clientPersist ? (meta.clientMessages ?? []) : undefined,
              clientMemories: clientPersist ? (meta.clientMemories ?? []) : undefined,
              forceAutoMemoryWrite: user.role === "guest",
              actor: { userId: user.id, role: user.role },
              signal: request.signal,
            },
            emit,
          );
        } catch (error) {
          emit(voiceErrorEvent("chat", error));
        } finally {
          try {
            controller.close();
          } catch {
            // 客户端已断开
          }
        }
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  });
}
