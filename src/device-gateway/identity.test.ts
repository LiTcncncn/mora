import { describe, expect, it } from "vitest";
import { LEGACY_DEVICE_ID } from "@/domain/device";
import { createDeviceAuthenticator, deviceSecret } from "./identity";

const token = "shared-token";
const authenticate = createDeviceAuthenticator(token);

function hello(lines: string[]): Buffer {
  return Buffer.from(lines.join("\n"));
}

describe("createDeviceAuthenticator", () => {
  it("accepts a v1 hello signed for that device id", () => {
    const deviceId = "zhaka-a1b2c3d4e5f6";
    const identity = authenticate(
      hello(["v1", deviceId, deviceSecret(token, deviceId), "0.3.0", "-61"]),
    );
    expect(identity).toEqual({
      deviceId,
      firmwareVersion: "0.3.0",
      rssi: -61,
      legacy: false,
    });
  });

  it("rejects a signature copied from another device", () => {
    const signature = deviceSecret(token, "zhaka-000000000001");
    expect(authenticate(hello(["v1", "zhaka-000000000002", signature, "0.3.0", "-60"]))).toBeNull();
  });

  it("rejects malformed device ids", () => {
    const deviceId = "../../etc";
    expect(authenticate(hello(["v1", deviceId, deviceSecret(token, deviceId), "", ""]))).toBeNull();
  });

  it("maps the old shared-token hello to the legacy device", () => {
    expect(authenticate(Buffer.from(token))).toMatchObject({ deviceId: LEGACY_DEVICE_ID, legacy: true });
    expect(authenticate(Buffer.from("wrong"))).toBeNull();
  });
});
