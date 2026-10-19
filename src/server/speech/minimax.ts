import "server-only";
import { AppError } from "../api/errors";
import { mapProviderError } from "../adapters/provider-error";
import {
  getMinimaxApiKey,
  getMinimaxAsrModel,
  getMinimaxBaseUrl,
  getMinimaxTtsModel,
} from "../config/env";
import { VOICE_OUTPUT_SAMPLE_RATE } from "@/domain/voice";

const ASR_TIMEOUT_MS = 30_000;
const TTS_TIMEOUT_MS = 30_000;

function requireApiKey(): string {
  const apiKey = getMinimaxApiKey();
  if (!apiKey) {
    throw new AppError("PROVIDER_NOT_CONFIGURED", "MiniMax 尚未配置 API Key");
  }
  return apiKey;
}

function timeoutSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

function mapFetchFailure(label: string, error: unknown, timeoutMs: number): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    if (error.name === "AbortError" || /aborted/i.test(error.message)) {
      return new AppError("PROVIDER_TIMEOUT", `${label} 调用已取消`);
    }
    return new AppError("PROVIDER_TIMEOUT", `${label} 调用超时（${timeoutMs}ms）`);
  }
  return mapProviderError(label, null, error instanceof Error ? error.message : "未知错误");
}

interface AsrResponse {
  text?: string;
  duration?: number;
  trace_id?: string;
  error?: { message?: string };
}

export async function transcribeWav(
  wav: Blob,
  signal?: AbortSignal,
): Promise<{ text: string; durationSec: number | null; traceId: string | null }> {
  const apiKey = requireApiKey();
  const form = new FormData();
  form.append("model", getMinimaxAsrModel());
  form.append("file", wav, "turn.wav");

  try {
    const response = await fetch(`${getMinimaxBaseUrl()}/v1/speech_to_text`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: timeoutSignal(ASR_TIMEOUT_MS, signal),
    });
    const raw = await response.text();
    let parsed: AsrResponse;
    try {
      parsed = JSON.parse(raw) as AsrResponse;
    } catch {
      throw mapProviderError("MiniMax ASR", response.status, "返回内容不是合法 JSON");
    }
    if (!response.ok) {
      throw mapProviderError(
        "MiniMax ASR",
        response.status,
        parsed.error?.message ?? `HTTP ${response.status}`,
      );
    }
    return {
      text: (parsed.text ?? "").trim(),
      durationSec: parsed.duration ?? null,
      traceId: parsed.trace_id ?? null,
    };
  } catch (error) {
    throw mapFetchFailure("MiniMax ASR", error, ASR_TIMEOUT_MS);
  }
}

interface TtsChunk {
  data?: { audio?: string; status?: number } | null;
  base_resp?: { status_code?: number; status_msg?: string };
}

function assertTtsOk(chunk: TtsChunk, httpStatus: number): void {
  const code = chunk.base_resp?.status_code ?? 0;
  if (code === 0) return;
  const status = code === 1004 ? 401 : code === 1002 || code === 1039 ? 429 : httpStatus;
  throw mapProviderError(
    "MiniMax TTS",
    status >= 400 ? status : 400,
    `${chunk.base_resp?.status_msg ?? "合成失败"}（${code}）`,
  );
}

/**
 * 流式合成单句语音，逐块产出 32kHz 单声道 PCM16。
 * 产出的每块长度都是偶数字节，保证样本不被截断。
 */
export async function* synthesizeSpeech(input: {
  text: string;
  voiceId: string;
  signal?: AbortSignal;
}): AsyncGenerator<Uint8Array> {
  const apiKey = requireApiKey();
  let response: Response;
  try {
    response = await fetch(`${getMinimaxBaseUrl()}/v1/t2a_v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: getMinimaxTtsModel(),
        text: input.text,
        stream: true,
        stream_options: { exclude_aggregated_audio: true },
        language_boost: "auto",
        voice_setting: { voice_id: input.voiceId, speed: 1, vol: 1, pitch: 0 },
        audio_setting: {
          sample_rate: VOICE_OUTPUT_SAMPLE_RATE,
          format: "pcm",
          channel: 1,
        },
      }),
      signal: timeoutSignal(TTS_TIMEOUT_MS, input.signal),
    });
  } catch (error) {
    throw mapFetchFailure("MiniMax TTS", error, TTS_TIMEOUT_MS);
  }

  if (!response.ok || !response.body) {
    const raw = await response.text().catch(() => "");
    let message = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(raw) as TtsChunk;
      message = parsed.base_resp?.status_msg ?? message;
    } catch {
      // 保持 HTTP 状态文案
    }
    throw mapProviderError("MiniMax TTS", response.status, message);
  }

  const isStream = (response.headers.get("content-type") ?? "").includes("event-stream");
  if (!isStream) {
    const parsed = JSON.parse(await response.text()) as TtsChunk;
    assertTtsOk(parsed, response.status);
    if (parsed.data?.audio) yield hexToBytes(parsed.data.audio);
    return;
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  let carry: number | null = null;
  let yielded = 0;

  const emit = (hex: string): Uint8Array | null => {
    let bytes = hexToBytes(hex);
    if (carry !== null) {
      const joined = new Uint8Array(bytes.length + 1);
      joined[0] = carry;
      joined.set(bytes, 1);
      bytes = joined;
      carry = null;
    }
    if (bytes.length % 2 === 1) {
      carry = bytes[bytes.length - 1]!;
      bytes = bytes.subarray(0, bytes.length - 1);
    }
    if (bytes.length === 0) return null;
    yielded += bytes.length;
    return bytes;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += value;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        const chunk = JSON.parse(payload) as TtsChunk;
        assertTtsOk(chunk, response.status);
        const audio = chunk.data?.audio;
        if (!audio) continue;
        // 结束块若携带整段聚合音频，则跳过避免重复播放。
        if (chunk.data?.status === 2 && yielded > 0 && audio.length / 2 >= yielded) continue;
        const bytes = emit(audio);
        if (bytes) yield bytes;
      }
    }
  } catch (error) {
    throw mapFetchFailure("MiniMax TTS", error, TTS_TIMEOUT_MS);
  } finally {
    reader.releaseLock();
  }
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}
