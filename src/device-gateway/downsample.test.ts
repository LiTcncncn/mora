import { describe, expect, it } from "vitest";
import { PcmDownsampler } from "./downsample";

function pcm(values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeInt16LE(value, index * 2));
  return buffer;
}

function rms(samples: Int16Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

describe("PcmDownsampler", () => {
  it("每两个 32kHz 样本出一个 16kHz 样本，直流不变", () => {
    const output = new PcmDownsampler().push(pcm(Array<number>(200).fill(1000)));
    expect(output).toHaveLength(100);
    expect(output[99]).toBe(1000);
  });

  it("跨分片保留半个样本", () => {
    const downsampler = new PcmDownsampler();
    expect(downsampler.push(pcm([10]).subarray(0, 1))).toHaveLength(0);
    expect(downsampler.push(Buffer.concat([pcm([10]).subarray(1), pcm([30])]))).toHaveLength(1);
  });

  it("压掉会折叠回来的高频", () => {
    const tone = (hz: number) =>
      Array.from({ length: 3200 }, (_, index) =>
        Math.round(10000 * Math.sin((2 * Math.PI * hz * index) / 32000)),
      );
    const low = new PcmDownsampler().push(pcm(tone(1000)));
    const high = new PcmDownsampler().push(pcm(tone(12000)));
    expect(rms(low.subarray(50))).toBeGreaterThan(6000);
    expect(rms(high.subarray(50))).toBeLessThan(300);
  });
});
