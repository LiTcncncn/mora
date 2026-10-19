/** 一条 WebSocket 二进制消息就是一帧：第 1 字节是类型，其余是载荷。 */

export const DeviceFrame = {
  hello: 0x01,
  audio: 0x02,
  meter: 0x03,
  /** 设备喇叭真正放完、马达停下后回报：[欠载次数 u16 LE, 溢出字节 u16 LE]。 */
  playbackDone: 0x04,
  authOk: 0x10,
  authFail: 0x11,
  bind: 0x12,
  status: 0x13,
  text: 0x14,
  pcm: 0x15,
  audioEnd: 0x16,
  haptic: 0x17,
  error: 0x18,
  /** admin 远程让设备重启进配网热点；新 Wi-Fi 连上前旧的仍保留。 */
  provision: 0x19,
} as const;

export const DeviceStatus = {
  listen: 0,
  think: 1,
  speak: 2,
} as const;

export interface DeviceFrameMessage {
  type: number;
  payload: Buffer;
}

export function encodeFrame(type: number, payload: Uint8Array = new Uint8Array()): Buffer {
  const frame = Buffer.alloc(1 + payload.byteLength);
  frame[0] = type;
  Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(frame, 1);
  return frame;
}

export function decodeFrame(message: Uint8Array): DeviceFrameMessage | null {
  if (message.byteLength < 1) return null;
  return {
    type: message[0]!,
    payload: Buffer.from(message.buffer, message.byteOffset + 1, message.byteLength - 1),
  };
}

export function encodeStatus(status: number): Buffer {
  return encodeFrame(DeviceFrame.status, Uint8Array.of(status));
}

export function encodeBind(bound: boolean): Buffer {
  return encodeFrame(DeviceFrame.bind, Uint8Array.of(bound ? 1 : 0));
}

export function encodeHaptic(durationMs: number): Buffer {
  const payload = new Uint8Array(2);
  new DataView(payload.buffer).setUint16(0, durationMs, true);
  return encodeFrame(DeviceFrame.haptic, payload);
}

export function encodePlaybackDone(underruns: number, overflowBytes: number): Buffer {
  const payload = Buffer.alloc(4);
  payload.writeUInt16LE(Math.min(65535, underruns), 0);
  payload.writeUInt16LE(Math.min(65535, overflowBytes), 2);
  return encodeFrame(DeviceFrame.playbackDone, payload);
}

export function encodeText(role: "user" | "assistant", text: string): Buffer {
  const body = Buffer.from(text);
  const payload = Buffer.alloc(1 + body.length);
  payload[0] = role === "user" ? 0 : 1;
  body.copy(payload, 1);
  return encodeFrame(DeviceFrame.text, payload);
}
