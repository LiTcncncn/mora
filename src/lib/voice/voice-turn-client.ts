"use client";

import type { VoiceTurnEvent } from "@/domain/voice";
import { ApiRequestError } from "@/lib/api-client";

/** 提交一句话的 WAV，逐行读取 NDJSON 事件。 */
export async function postVoiceTurn(
  form: FormData,
  onEvent: (event: VoiceTurnEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/voice/turn", {
    method: "POST",
    body: form,
    credentials: "same-origin",
    signal,
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("ndjson") || !response.body) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code: string; message: string };
    } | null;
    throw new ApiRequestError(
      payload?.error ?? { code: "UNKNOWN_ERROR", message: `HTTP ${response.status}` },
    );
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += value;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as VoiceTurnEvent);
    }
  }
  if (pending.trim()) onEvent(JSON.parse(pending) as VoiceTurnEvent);
}
