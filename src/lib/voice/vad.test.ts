import { describe, expect, it } from "vitest";
import { encodeWav } from "./pcm";
import { EnergyVad } from "./vad";

const RATE = 16_000;

function tone(ms: number, amplitude: number): Float32Array {
  const samples = new Float32Array((RATE * ms) / 1000);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude * Math.sin((2 * Math.PI * 220 * index) / RATE);
  }
  return samples;
}

function feed(vad: EnergyVad, samples: Float32Array): Int16Array | null {
  let result: Int16Array | null = null;
  for (let offset = 0; offset < samples.length; offset += 512) {
    result = vad.push(samples.subarray(offset, offset + 512)) ?? result;
  }
  return result;
}

describe("EnergyVad", () => {
  const options = { sampleRate: RATE, endSilenceMs: 1_200, maxUtteranceMs: 60_000 };

  it("说话后静音 1.2 秒产出一句话", () => {
    const vad = new EnergyVad(options);
    expect(feed(vad, tone(500, 0))).toBeNull();
    expect(feed(vad, tone(800, 0.3))).toBeNull();
    const utterance = feed(vad, tone(1_300, 0));
    expect(utterance).not.toBeNull();
    // 保留预录与少量尾静音，去掉大部分结束静音
    expect(utterance!.length / RATE).toBeGreaterThan(0.8);
    expect(utterance!.length / RATE).toBeLessThan(1.5);
  });

  it("过短的声响不算一句话", () => {
    const vad = new EnergyVad(options);
    feed(vad, tone(500, 0));
    feed(vad, tone(160, 0.3));
    expect(feed(vad, tone(1_300, 0))).toBeNull();
  });

  it("较轻的后半句仍然留在同一句里", () => {
    const vad = new EnergyVad({
      ...options,
      rmsFloor: 0.006,
      noiseMultiplier: 3.2,
      holdFloor: 0.004,
      holdMultiplier: 1.8,
      tailKeepMs: 500,
    });
    feed(vad, tone(300, 0));
    expect(feed(vad, tone(400, 0.08))).toBeNull();
    expect(feed(vad, tone(800, 0.018))).toBeNull();
    const utterance = feed(vad, tone(1_300, 0));
    expect(utterance).not.toBeNull();
    expect(utterance!.length / RATE).toBeGreaterThan(1.4);
  });

  it("短应答也能收成一句", () => {
    const vad = new EnergyVad({ ...options, minSpeechMs: 160 });
    feed(vad, tone(300, 0));
    feed(vad, tone(180, 0.3));
    expect(feed(vad, tone(1_300, 0))).not.toBeNull();
  });

  it("标定后的底噪不会开口", () => {
    const vad = new EnergyVad({
      ...options,
      rmsFloor: 0.006,
      noiseMultiplier: 3.2,
      noisePercentile: 0.95,
      calibrationMs: 400,
      adaptiveNoise: true,
    });
    expect(feed(vad, tone(2_000, 0.008))).toBeNull();
  });

  it("噪声底被抬高后，开口线仍停在 0.012", () => {
    const vad = new EnergyVad({
      ...options,
      endSilenceMs: 800,
      rmsFloor: 0.006,
      noiseMultiplier: 3.2,
      holdFloor: 0.004,
      holdMultiplier: 1.8,
      noisePercentile: 0.95,
      adaptiveNoise: true,
      minSpeechMs: 160,
      startSpeechMs: 100,
      maxStartThreshold: 0.012,
      noiseObserveCeiling: 0.008,
    });
    expect(feed(vad, tone(1_500, 0.008))).toBeNull();
    expect(feed(vad, tone(300, 0.02))).toBeNull();
    const utterance = feed(vad, tone(1_000, 0));
    expect(utterance).not.toBeNull();
    expect(vad.lastStats?.startThreshold).toBeLessThanOrEqual(0.012);
  });

  it("碰撞和尾音不把噪声底抬过观察上限", () => {
    const vad = new EnergyVad({
      ...options,
      endSilenceMs: 800,
      rmsFloor: 0.006,
      noiseMultiplier: 3.2,
      holdFloor: 0.004,
      holdMultiplier: 1.8,
      noisePercentile: 0.95,
      adaptiveNoise: true,
      minSpeechMs: 160,
      startSpeechMs: 100,
      maxStartThreshold: 0.012,
      noiseObserveCeiling: 0.008,
    });
    feed(vad, tone(1_500, 0.008));
    feed(vad, tone(1_500, 0.012));
    feed(vad, tone(300, 0.05));
    expect(feed(vad, tone(1_000, 0))).not.toBeNull();
    expect(vad.lastStats!.noiseFloor).toBeLessThan(0.007);
  });

  it("达到最长时长时强制收口", () => {
    const vad = new EnergyVad({ ...options, maxUtteranceMs: 1_000 });
    feed(vad, tone(200, 0));
    expect(feed(vad, tone(1_500, 0.3))).not.toBeNull();
  });
});

describe("encodeWav", () => {
  it("写出 16kHz 单声道 PCM16 头", async () => {
    const wav = encodeWav(new Int16Array([1, -1, 2]), RATE);
    const view = new DataView(await wav.arrayBuffer());
    expect(wav.size).toBe(44 + 6);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
  });
});
