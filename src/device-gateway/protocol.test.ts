import { describe, expect, it } from "vitest";
import { DeviceFrame, decodeFrame, encodeFrame, encodeHaptic, encodePlaybackDone } from "./protocol";

describe("device frames", () => {
  it("来回保留类型和载荷", () => {
    const frame = encodeFrame(DeviceFrame.hello, Buffer.from("token"));
    expect(decodeFrame(frame)).toEqual({
      type: DeviceFrame.hello,
      payload: Buffer.from("token"),
    });
  });

  it("震动时长按小端双字节编码", () => {
    const frame = encodeHaptic(500);
    expect(frame[0]).toBe(DeviceFrame.haptic);
    expect(frame.readUInt16LE(1)).toBe(500);
  });

  it("播放完成带上欠载和溢出", () => {
    const frame = encodePlaybackDone(3, 12);
    expect(frame[0]).toBe(DeviceFrame.playbackDone);
    expect(frame.readUInt16LE(1)).toBe(3);
    expect(frame.readUInt16LE(3)).toBe(12);
  });
});
