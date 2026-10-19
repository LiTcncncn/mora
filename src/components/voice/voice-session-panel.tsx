"use client";

import { useEffect, useState } from "react";
import type { ModelSlot } from "@/domain/settings";
import { VOICE_OPTIONS, type VoiceId } from "@/domain/voice";
import {
  useVoiceSession,
  type VoicePhase,
  type VoiceTurnContext,
  type VoiceTurnDone,
} from "./use-voice-session";

const PHASE_TEXT: Record<Exclude<VoicePhase, "idle">, string> = {
  starting: "正在打开麦克风…",
  listening: "正在听，直接说就好",
  recognizing: "听到了…",
  thinking: "ZHAKA 在想…",
  speaking: "ZHAKA 正在说",
};

export function VoiceSessionPanel({
  slots,
  disabled,
  getTurnContext,
  onTurnDone,
  onError,
  onActiveChange,
}: {
  slots: ModelSlot[];
  disabled: boolean;
  getTurnContext: () => VoiceTurnContext | null;
  onTurnDone: (event: VoiceTurnDone) => Promise<void> | void;
  onError: (message: string) => void;
  onActiveChange: (active: boolean) => void;
}) {
  const [slotId, setSlotId] = useState<string>("");
  const [voiceId, setVoiceId] = useState<VoiceId>(VOICE_OPTIONS[0].id);
  const session = useVoiceSession({ getTurnContext, onTurnDone, onError });

  const selectedSlotId = slots.some((slot) => slot.id === slotId)
    ? slotId
    : (slots[0]?.id ?? "");

  useEffect(() => {
    onActiveChange(session.active);
  }, [onActiveChange, session.active]);

  if (!session.active) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {slots.length > 1 ? (
          <label className="flex items-center gap-1">
            <span className="text-[var(--color-muted)]">语音模型</span>
            <select
              className="rounded border px-2 py-1"
              value={selectedSlotId}
              onChange={(event) => setSlotId(event.target.value)}
            >
              {slots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex items-center gap-1">
          <span className="text-[var(--color-muted)]">声音</span>
          <select
            className="rounded border px-2 py-1"
            value={voiceId}
            onChange={(event) => setVoiceId(event.target.value as VoiceId)}
          >
            {VOICE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn"
          disabled={disabled || !selectedSlotId}
          onClick={() => void session.start({ modelSlotId: selectedSlotId, voiceId })}
        >
          开始语音对话
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 rounded border bg-[var(--color-bg)] p-2 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            session.phase === "listening" ? "animate-pulse bg-green-600" : "bg-[var(--color-muted)]"
          }`}
        />
        <span>{PHASE_TEXT[session.phase as Exclude<VoicePhase, "idle">]}</span>
        <button type="button" className="btn ml-auto" onClick={session.stop}>
          结束语音对话
        </button>
      </div>
      {session.liveUser ? (
        <p className="whitespace-pre-wrap break-words">
          <span className="text-[var(--color-muted)]">我：</span>
          {session.liveUser}
        </p>
      ) : null}
      {session.liveReply ? (
        <p className="whitespace-pre-wrap break-words">
          <span className="text-[var(--color-muted)]">ZHAKA：</span>
          {session.liveReply}
        </p>
      ) : null}
    </div>
  );
}
