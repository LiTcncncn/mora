"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationMessage } from "@/domain/conversation";
import type { MemoryItem } from "@/domain/memory";
import {
  VOICE_END_SILENCE_MS,
  VOICE_INPUT_SAMPLE_RATE,
  VOICE_MAX_UTTERANCE_MS,
  VOICE_OUTPUT_SAMPLE_RATE,
  type VoiceId,
  type VoiceTurnEvent,
  type VoiceTurnStage,
} from "@/domain/voice";
import { errorMessage } from "@/lib/api-client";
import { Microphone, PcmPlayer } from "@/lib/voice/audio-io";
import { base64ToBytes, encodeWav } from "@/lib/voice/pcm";
import { EnergyVad } from "@/lib/voice/vad";
import { postVoiceTurn } from "@/lib/voice/voice-turn-client";

export type VoicePhase =
  | "idle"
  | "starting"
  | "listening"
  | "recognizing"
  | "thinking"
  | "speaking";

export type VoiceTurnDone = Extract<VoiceTurnEvent, { type: "done" }>;

export interface VoiceTurnContext {
  profileId: string;
  conversationId: string;
  clientMessages?: ConversationMessage[];
  clientMemories?: MemoryItem[];
}

export interface VoiceSessionConfig {
  modelSlotId: string;
  voiceId: VoiceId;
}

const STAGE_LABELS: Record<VoiceTurnStage, string> = {
  asr: "语音识别",
  chat: "对话模型",
  tts: "语音合成",
};

/**
 * 连续语音会话：听 → 自动判停 → 提交 → 边收边播 → 播完恢复聆听。
 * ZHAKA 说话期间不收音（首版不做打断）。
 */
export function useVoiceSession(handlers: {
  getTurnContext: () => VoiceTurnContext | null;
  onTurnDone: (event: VoiceTurnDone) => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [liveUser, setLiveUser] = useState("");
  const [liveReply, setLiveReply] = useState("");

  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  const activeRef = useRef(false);
  const listeningRef = useRef(false);
  const configRef = useRef<VoiceSessionConfig | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const micRef = useRef<Microphone | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const vadRef = useRef<EnergyVad | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resumeListening = useCallback(() => {
    if (!activeRef.current) return;
    setLiveUser("");
    setLiveReply("");
    vadRef.current?.reset();
    listeningRef.current = true;
    setPhase("listening");
  }, []);

  const handleUtterance = useCallback(
    async (pcm: Int16Array) => {
      const config = configRef.current;
      const turnContext = handlersRef.current.getTurnContext();
      if (!config || !turnContext) {
        resumeListening();
        return;
      }
      setPhase("recognizing");
      const form = new FormData();
      form.append("meta", JSON.stringify({ ...turnContext, ...config }));
      form.append("audio", encodeWav(pcm, VOICE_INPUT_SAMPLE_RATE), "turn.wav");

      const abort = new AbortController();
      abortRef.current = abort;
      let done: VoiceTurnDone | null = null;
      try {
        await postVoiceTurn(
          form,
          (event) => {
            if (!activeRef.current) return;
            switch (event.type) {
              case "transcript":
                setLiveUser(event.text);
                setPhase("thinking");
                break;
              case "text":
                setLiveReply((current) => current + event.text);
                break;
              case "audio":
                playerRef.current?.enqueue(base64ToBytes(event.data));
                setPhase("speaking");
                break;
              case "haptic":
              case "timing":
              case "speech_end":
                break;
              case "error":
                handlersRef.current.onError(
                  `${STAGE_LABELS[event.stage]}调用失败：${event.message}`,
                );
                break;
              case "done":
                done = event;
                break;
              case "empty":
                break;
            }
          },
          abort.signal,
        );
        if (done) await handlersRef.current.onTurnDone(done);
        await playerRef.current?.whenDrained();
      } catch (caught) {
        if (abort.signal.aborted) return;
        handlersRef.current.onError(errorMessage(caught));
      } finally {
        if (abortRef.current === abort) abortRef.current = null;
      }
      resumeListening();
    },
    [resumeListening],
  );

  const stop = useCallback(() => {
    activeRef.current = false;
    listeningRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    playerRef.current?.stop();
    playerRef.current = null;
    micRef.current?.close();
    micRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
    vadRef.current = null;
    setLiveUser("");
    setLiveReply("");
    setPhase("idle");
  }, []);

  const start = useCallback(
    async (config: VoiceSessionConfig) => {
      if (activeRef.current) return;
      activeRef.current = true;
      configRef.current = config;
      setPhase("starting");
      try {
        const context = new AudioContext();
        contextRef.current = context;
        await context.resume();
        playerRef.current = new PcmPlayer(context, VOICE_OUTPUT_SAMPLE_RATE);
        const vad = new EnergyVad({
          sampleRate: VOICE_INPUT_SAMPLE_RATE,
          endSilenceMs: VOICE_END_SILENCE_MS,
          maxUtteranceMs: VOICE_MAX_UTTERANCE_MS,
        });
        vadRef.current = vad;
        micRef.current = await Microphone.open(context, (samples) => {
          if (!listeningRef.current) return;
          const utterance = vad.push(samples);
          if (!utterance) return;
          listeningRef.current = false;
          void handleUtterance(utterance);
        });
        if (!activeRef.current) {
          micRef.current.close();
          return;
        }
        resumeListening();
      } catch (caught) {
        stop();
        handlersRef.current.onError(
          caught instanceof DOMException && caught.name === "NotAllowedError"
            ? "麦克风权限被拒绝，请在浏览器地址栏允许使用麦克风"
            : errorMessage(caught),
        );
      }
    },
    [handleUtterance, resumeListening, stop],
  );

  useEffect(() => stop, [stop]);

  return { phase, active: phase !== "idle", liveUser, liveReply, start, stop };
}
