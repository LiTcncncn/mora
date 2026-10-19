import { createHmac, timingSafeEqual } from "node:crypto";
import { DEVICE_ID_PATTERN, LEGACY_DEVICE_ID } from "@/domain/device";

export interface DeviceIdentity {
  deviceId: string;
  firmwareVersion: string | null;
  rssi: number | null;
  legacy: boolean;
}

export type DeviceAuthenticator = (payload: Buffer) => DeviceIdentity | null;

/** 每台设备的密钥：烧录时由同一个 DEVICE_TOKEN 按设备 ID 派生，网关不用存表。 */
export function deviceSecret(token: string, deviceId: string): string {
  return createHmac("sha256", token).update(deviceId).digest("hex");
}

function safeEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/**
 * hello 载荷：
 * - 新固件：`v1\n<deviceId>\n<HMAC 十六进制>\n<固件版本>\n<RSSI>`
 * - 旧固件：整段就是 DEVICE_TOKEN
 */
export function createDeviceAuthenticator(token: string): DeviceAuthenticator {
  return (payload) => {
    const text = payload.toString("utf8");
    if (!text.startsWith("v1\n")) {
      return safeEqual(text, token)
        ? { deviceId: LEGACY_DEVICE_ID, firmwareVersion: null, rssi: null, legacy: true }
        : null;
    }
    const [, deviceId = "", signature = "", firmware = "", rssi = ""] = text.split("\n");
    if (!DEVICE_ID_PATTERN.test(deviceId)) return null;
    if (!safeEqual(signature.toLowerCase(), deviceSecret(token, deviceId))) return null;
    const rssiValue = Number.parseInt(rssi, 10);
    return {
      deviceId,
      firmwareVersion: firmware.trim().slice(0, 40) || null,
      rssi: Number.isFinite(rssiValue) ? rssiValue : null,
      legacy: false,
    };
  };
}
