import { describe, expect, it } from "vitest";
import { mapProviderError } from "./provider-error";

describe("mapProviderError", () => {
  it("把无状态码的 Request timed out 映射为超时，而不是笼统的不可用", () => {
    const error = mapProviderError("OpenAI", null, "Request timed out.");
    expect(error.code).toBe("PROVIDER_TIMEOUT");
    expect(error.message).toContain("Request timed out");
  });

  it("401 仍映射为认证失败", () => {
    expect(mapProviderError("OpenAI", 401, "invalid").code).toBe(
      "PROVIDER_AUTH_ERROR",
    );
  });
});
