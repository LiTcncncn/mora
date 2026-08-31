import { describe, expect, it } from "vitest";
import { REDACTED, sanitizeText, sanitizeValue } from "./sanitize";

describe("sanitizeText", () => {
  it("清洗已知密钥", () => {
    const secret = "sk-test-kimi-key-value";
    expect(sanitizeText(`失败：${secret}`, [secret])).toBe(`失败：${REDACTED}`);
  });

  it("清洗未知的 sk- 形式密钥", () => {
    expect(sanitizeText("key sk-abcdefgh12345678")).toContain(REDACTED);
  });

  it("清洗 Authorization header 值", () => {
    expect(sanitizeText("Bearer abcdefgh12345678")).toBe(REDACTED);
  });
});

describe("sanitizeValue", () => {
  it("按键名清洗敏感字段", () => {
    const result = sanitizeValue({
      headers: { Authorization: "Bearer abcdefgh12345678" },
      apiKey: "sk-abcdefgh12345678",
      safe: "正常内容",
    }) as Record<string, unknown>;

    expect(result.apiKey).toBe(REDACTED);
    expect(result.safe).toBe("正常内容");
  });
});
