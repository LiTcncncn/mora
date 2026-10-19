import { describe, expect, it } from "vitest";
import { prepareForAsr } from "./prepare-asr";

const RATE = 16_000;

function tone(ms: number, amplitude: number): Int16Array {
  const samples = new Int16Array((RATE * ms) / 1000);
  for (let index = 0; index < samples.length; index += 1) {
    const value = amplitude * Math.sin((2 * Math.PI * 220 * index) / RATE);
    samples[index] = Math.round(value * 32767);
  }
  return samples;
}

function concat(parts: Int16Array[]): Int16Array {
  const output = new Int16Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function peak(samples: Int16Array): number {
  let max = 0;
  for (const sample of samples) max = Math.max(max, Math.abs(sample));
  return max / 32767;
}

describe("prepareForAsr", () => {
  it("裁掉前后静音，并把过轻的峰值拉到 0.25 附近", () => {
    const prepared = prepareForAsr(concat([tone(800, 0), tone(220, 0.02), tone(800, 0)]), RATE);
    expect(prepared.length / RATE).toBeGreaterThan(0.3);
    expect(prepared.length / RATE).toBeLessThan(0.5);
    expect(peak(prepared)).toBeGreaterThan(0.24);
    expect(peak(prepared)).toBeLessThanOrEqual(0.26);
  });

  it("已经够响的片段只裁静音，不再压小", () => {
    const prepared = prepareForAsr(concat([tone(500, 0), tone(300, 0.4), tone(500, 0)]), RATE);
    expect(peak(prepared)).toBeGreaterThan(0.35);
    expect(prepared.length / RATE).toBeLessThan(0.6);
  });
});
