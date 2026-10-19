import { afterEach, describe, expect, it, vi } from "vitest";
import { synthesizeSpeech, transcribeWav } from "./minimax";

function sse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

async function collect(stream: AsyncGenerator<Uint8Array>): Promise<number[]> {
  const bytes: number[] = [];
  for await (const chunk of stream) {
    expect(chunk.length % 2).toBe(0);
    bytes.push(...chunk);
  }
  return bytes;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MiniMax TTS 流式解析", () => {
  it("拼接 hex 音频块，并补齐跨块的奇数字节", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse([
          { data: { audio: "010203", status: 1 }, base_resp: { status_code: 0 } },
          { data: { audio: "04", status: 1 }, base_resp: { status_code: 0 } },
          { data: { audio: "", status: 2 }, base_resp: { status_code: 0 } },
        ]),
      ),
    );
    const bytes = await collect(synthesizeSpeech({ text: "你好", voiceId: "v" }));
    expect(bytes).toEqual([1, 2, 3, 4]);
  });

  it("跳过结束块里的聚合音频，避免重复播放", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse([
          { data: { audio: "0102", status: 1 }, base_resp: { status_code: 0 } },
          { data: { audio: "0102", status: 2 }, base_resp: { status_code: 0 } },
        ]),
      ),
    );
    expect(await collect(synthesizeSpeech({ text: "你好", voiceId: "v" }))).toEqual([1, 2]);
  });

  it("base_resp 非 0 时报错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sse([{ data: null, base_resp: { status_code: 1004, status_msg: "auth" } }]),
      ),
    );
    await expect(collect(synthesizeSpeech({ text: "你好", voiceId: "v" }))).rejects.toMatchObject(
      { code: "PROVIDER_AUTH_ERROR" },
    );
  });
});

describe("MiniMax ASR", () => {
  it("以 multipart 上传 WAV 并返回文本", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ text: " 今天好累 ", duration: 1.2, trace_id: "t1" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await transcribeWav(new Blob([new Uint8Array(44)], { type: "audio/wav" }));
    expect(result).toEqual({ text: "今天好累", durationSec: 1.2, traceId: "t1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.minimax.cn/v1/speech_to_text");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("asr-1.0");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("HTTP 错误映射为供应商错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ type: "error", error: { message: "rate limit" } }, { status: 429 }),
      ),
    );
    await expect(transcribeWav(new Blob([]))).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
    });
  });
});
