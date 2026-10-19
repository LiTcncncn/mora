import { describe, expect, it } from "vitest";
import type { VoiceTurnEvent } from "@/domain/voice";
import { DeviceFrame, decodeFrame } from "./protocol";
import { DeviceLink, type DeviceBinding } from "./link";

const binding: DeviceBinding = {
  profileId: "profile-default",
  conversationId: "conv-1",
  modelSlotId: "slot-kimi",
  voiceId: "Chinese (Mandarin)_Warm_Girl",
};

function frame(type: number, payload: Uint8Array): Buffer {
  const message = Buffer.alloc(1 + payload.byteLength);
  message[0] = type;
  Buffer.from(payload).copy(message, 1);
  return message;
}

/** 1kHz 方波当作说话，静音为 0。高通会滤掉直流，所以不能用恒定值。 */
function audio(segments: Array<[seconds: number, amplitude: number]>): Buffer[] {
  const messages: Buffer[] = [];
  for (const [seconds, amplitude] of segments) {
    const count = Math.round(16_000 * seconds);
    for (let offset = 0; offset < count; offset += 320) {
      const samples = new Int16Array(Math.min(320, count - offset));
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = (offset + index) % 16 < 8 ? amplitude : -amplitude;
      }
      messages.push(frame(DeviceFrame.audio, Buffer.from(samples.buffer)));
    }
  }
  return messages;
}

function loudThenSilence(): Buffer[] {
  return audio([
    [1.0, 0],
    [0.4, 8000],
    [1.0, 0],
  ]);
}

function statuses(sent: Buffer[]): number[] {
  return sent.filter((message) => message[0] === DeviceFrame.status).map((message) => message[1]!);
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe("DeviceLink", () => {
  it("鉴权后把一句话收成回合，并在音频前发出短震", async () => {
    const sent: Buffer[] = [];
    let wavBytes = 0;
    const link = new DeviceLink(
      "device-token",
      (message) => sent.push(message),
      async (wav, _binding, _signal, emit) => {
        wavBytes = wav.size;
        emit({ type: "haptic", pattern: "e0", durationMs: 500 });
        const pcm = Buffer.alloc(8);
        pcm.writeInt16LE(1000, 0);
        pcm.writeInt16LE(1000, 2);
        pcm.writeInt16LE(-1000, 4);
        pcm.writeInt16LE(-1000, 6);
        emit({ type: "audio", data: pcm.toString("base64") });
        emit({ type: "done" } as VoiceTurnEvent);
      },
      0,
    );
    link.setBinding(binding);
    link.onMessage(frame(DeviceFrame.hello, Buffer.from("device-token")));
    for (const message of loudThenSilence()) link.onMessage(message);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const types = sent.map((message) => message[0]);
    expect(types).toContain(DeviceFrame.authOk);
    expect(types).toContain(DeviceFrame.haptic);
    expect(types).toContain(DeviceFrame.pcm);
    expect(types).toContain(DeviceFrame.audioEnd);
    const haptic = sent.find((message) => message[0] === DeviceFrame.haptic);
    expect(haptic?.readUInt16LE(1)).toBe(500);
    const pcm = sent.find((message) => message[0] === DeviceFrame.pcm);
    expect(decodeFrame(pcm ?? Buffer.alloc(0))?.payload.byteLength).toBe(4);
    expect(wavBytes).toBeGreaterThan(44);
    link.close();
  });

  it("长语音按 20ms 拆开下发，而不是一整包", async () => {
    const sent: Buffer[] = [];
    const link = new DeviceLink(
      "device-token",
      (message) => sent.push(message),
      async (_wav, _binding, _signal, emit) => {
        emit({ type: "audio", data: Buffer.alloc(3200).toString("base64") });
        emit({ type: "done" } as VoiceTurnEvent);
      },
      0,
    );
    link.setBinding(binding);
    link.onMessage(frame(DeviceFrame.hello, Buffer.from("device-token")));
    for (const message of loudThenSilence()) link.onMessage(message);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const payloads = sent
      .filter((message) => message[0] === DeviceFrame.pcm)
      .map((message) => decodeFrame(message)?.payload.byteLength ?? 0);
    expect(payloads.every((length) => length <= 640)).toBe(true);
    expect(payloads.reduce((total, length) => total + length, 0)).toBe(1600);
    expect(payloads).toEqual([640, 640, 320]);
    link.close();
  });

  it("令牌不对时不接收音频", async () => {
    let turns = 0;
    const sent: Buffer[] = [];
    const link = new DeviceLink(
      "device-token",
      (message) => sent.push(message),
      async () => {
        turns += 1;
      },
      0,
    );
    link.setBinding(binding);
    link.onMessage(frame(DeviceFrame.hello, Buffer.from("nope")));
    for (const message of loudThenSilence()) link.onMessage(message);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(turns).toBe(0);
    expect(sent.some((message) => message[0] === DeviceFrame.authFail)).toBe(true);
    link.close();
  });

  it("声音交完就等设备回报放完，再恢复收音，不等后台存档", async () => {
    const sent: Buffer[] = [];
    let releaseBackground: () => void = () => {};
    const background = new Promise<void>((resolve) => {
      releaseBackground = resolve;
    });
    const traces: string[] = [];
    const link = new DeviceLink(
      "device-token",
      (message) => sent.push(message),
      async (_wav, _binding, _signal, emit) => {
        emit({ type: "transcript", text: "你好", userMessageId: "m", comparisonGroupId: "c" });
        emit({ type: "audio", data: Buffer.alloc(640).toString("base64") });
        emit({ type: "speech_end" });
        await background;
      },
      0,
      { onTrace: (trace) => traces.push(trace.outcome) },
    );
    link.setBinding(binding);
    link.onMessage(frame(DeviceFrame.hello, Buffer.from("device-token")));
    for (const message of loudThenSilence()) link.onMessage(message);
    await tick();

    expect(sent.some((message) => message[0] === DeviceFrame.audioEnd)).toBe(true);
    expect(statuses(sent).at(-1)).toBe(2);
    link.onMessage(frame(DeviceFrame.playbackDone, Uint8Array.of(3, 0, 0, 0)));
    expect(statuses(sent).at(-1)).toBe(0);
    expect(traces).toEqual([]);

    releaseBackground();
    await tick();
    expect(traces).toEqual(["replied"]);
    link.close();
  });

  it("喇叭刚停时的余音不会开下一句", async () => {
    let turns = 0;
    const link = new DeviceLink(
      "device-token",
      () => {},
      async (_wav, _binding, _signal, emit) => {
        turns += 1;
        emit({ type: "audio", data: Buffer.alloc(640).toString("base64") });
        emit({ type: "speech_end" });
      },
      0,
    );
    link.setBinding(binding);
    link.onMessage(frame(DeviceFrame.hello, Buffer.from("device-token")));
    for (const message of loudThenSilence()) link.onMessage(message);
    await tick();
    link.onMessage(frame(DeviceFrame.playbackDone, Uint8Array.of(0, 0, 0, 0)));
    for (const message of audio([[0.3, 8000]])) link.onMessage(message);
    await tick();
    expect(turns).toBe(1);
    link.close();
  });

  it("识别时用户接着说，取消这一轮并把两段并成一句", async () => {
    const wavSizes: number[] = [];
    const aborted: boolean[] = [];
    const link = new DeviceLink(
      "device-token",
      () => {},
      async (wav, _binding, signal) => {
        wavSizes.push(wav.size);
        await new Promise((resolve) => setTimeout(resolve, 5));
        aborted.push(signal.aborted);
      },
      0,
    );
    link.setBinding(binding);
    link.onMessage(frame(DeviceFrame.hello, Buffer.from("device-token")));
    for (const message of audio([
      [1.0, 0],
      [0.4, 8000],
      [1.0, 0],
    ]))
      link.onMessage(message);
    expect(wavSizes).toHaveLength(1);
    for (const message of audio([
      [0.4, 8000],
      [1.0, 0],
    ]))
      link.onMessage(message);
    await tick();

    expect(wavSizes).toHaveLength(2);
    expect(wavSizes[1]!).toBeGreaterThan(wavSizes[0]! * 1.5);
    expect(aborted[0]).toBe(true);
    link.close();
  });

  it("持续的底噪不会被当成说话", async () => {
    let turns = 0;
    const link = new DeviceLink(
      "device-token",
      () => {},
      async () => {
        turns += 1;
      },
      0,
    );
    link.setBinding(binding);
    link.onMessage(frame(DeviceFrame.hello, Buffer.from("device-token")));
    for (const message of audio([[1.0, 0], [4, 250]])) link.onMessage(message);
    await tick();
    expect(turns).toBe(0);
    link.close();
  });

  it("麦克风读失败时记为失效", () => {
    const link = new DeviceLink("device-token", () => {}, async () => {}, 0);
    link.onMessage(frame(DeviceFrame.hello, Buffer.from("device-token")));
    link.onMessage(frame(DeviceFrame.meter, Uint8Array.of(1, 40)));
    expect(link.micSnapshot().ok).toBe(true);
    link.onMessage(frame(DeviceFrame.meter, Uint8Array.of(0, 0)));
    expect(link.micSnapshot().ok).toBe(false);
    link.close();
  });

  it("静音尾部抢跑识别，句末把文本交给回合", async () => {
    const sizes: number[] = [];
    let transcript: string | undefined;
    const link = new DeviceLink(
      "device-token",
      () => {},
      async (_wav, _binding, _signal, _emit, text) => {
        transcript = text;
      },
      0,
      {
        transcribe: async (wav) => {
          sizes.push(wav.size);
          return "你好";
        },
      },
    );
    link.setBinding(binding);
    link.onMessage(frame(DeviceFrame.hello, Buffer.from("device-token")));
    for (const message of loudThenSilence()) link.onMessage(message);
    await tick();
    expect(sizes.length).toBeGreaterThanOrEqual(1);
    expect(transcript).toBe("你好");
    link.close();
  });

  it("抢跑结果没有字时，用整句再识别一次", async () => {
    const texts = ["", "在吗"];
    let transcript: string | undefined;
    const link = new DeviceLink(
      "device-token",
      () => {},
      async (_wav, _binding, _signal, _emit, text) => {
        transcript = text;
      },
      0,
      {
        transcribe: async () => texts.shift() ?? "",
      },
    );
    link.setBinding(binding);
    link.onMessage(frame(DeviceFrame.hello, Buffer.from("device-token")));
    for (const message of loudThenSilence()) link.onMessage(message);
    await tick();
    expect(texts).toEqual([]);
    expect(transcript).toBe("在吗");
    link.close();
  });
});
