import { describe, expect, it } from "vitest";
import { otherGatewayPids } from "./singleton";

describe("硬件网关单实例", () => {
  it("只找出别的网关进程", () => {
    const output = [
      "  11 node --conditions=react-server src/device-gateway/main.ts",
      "  22 next dev",
      "  33 node src/device-gateway/main.ts",
      "not a process line",
    ].join("\n");
    expect(otherGatewayPids(output, 11)).toEqual([33]);
  });
});
