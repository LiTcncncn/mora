import { z } from "zod";
import type { ConversationMessage } from "./conversation";
import type { MemoryItem } from "./memory";

export const VOICE_OPTIONS = [
  { id: "Chinese (Mandarin)_Warm_Girl", label: "温暖女声" },
  { id: "Chinese (Mandarin)_ExplorativeGirl", label: "好奇女声" },
  { id: "Chinese (Mandarin)_Cute_Spirit", label: "可爱精灵" },
] as const;

export type VoiceId = (typeof VOICE_OPTIONS)[number]["id"];

export const voiceIdSchema = z.enum(
  VOICE_OPTIONS.map((option) => option.id) as [VoiceId, ...VoiceId[]],
);

/** 上行：单声道 16kHz PCM16 WAV。 */
export const VOICE_INPUT_SAMPLE_RATE = 16_000;
/** 下行：单声道 32kHz PCM16。 */
export const VOICE_OUTPUT_SAMPLE_RATE = 32_000;
/** VAD 连续静音多久视为一句话说完。 */
export const VOICE_END_SILENCE_MS = 1_200;
/** 单轮最长说话时长。 */
export const VOICE_MAX_UTTERANCE_MS = 60_000;
/** E1 短震。长震会拖到恢复收音之后，把马达噪声当成下一句。 */
export const VOICE_HAPTIC_MS = 500;

export type VoiceTurnStage = "asr" | "chat" | "tts";

export type VoiceTimingMark = "asr" | "router" | "first_token" | "first_audio";

export type VoiceTurnEvent =
  | { type: "empty" }
  | {
      type: "transcript";
      text: string;
      userMessageId: string;
      comparisonGroupId: string;
    }
  | { type: "text"; text: string }
  | { type: "audio"; data: string }
  | { type: "haptic"; pattern: "e0" | "e1"; durationMs: number }
  /** 各阶段完成时刻，毫秒，相对本轮开始识别。 */
  | { type: "timing"; mark: VoiceTimingMark; ms: number }
  /** 语音已经全部交出。存档与记忆抽取还会在后台继续，但设备可以开始收下一句。 */
  | { type: "speech_end" }
  | { type: "error"; stage: VoiceTurnStage; code: string; message: string }
  | {
      type: "done";
      userMessage: ConversationMessage;
      assistantMessage: ConversationMessage | null;
      memoryExtraction: {
        status: "succeeded" | "failed" | "disabled";
        candidateIds: string[];
        candidates?: MemoryItem[];
      };
      configHash: string;
      metrics: {
        asrLatencyMs: number;
        firstTokenLatencyMs: number | null;
        firstAudioLatencyMs: number | null;
      };
    };
