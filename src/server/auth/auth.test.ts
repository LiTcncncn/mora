import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import {
  decodeSession,
  encodeSession,
} from "@/server/auth/session";

describe("password", () => {
  it("hash 后可校验", () => {
    const encoded = hashPassword("a9k2m4");
    expect(verifyPassword("a9k2m4", encoded)).toBe(true);
    expect(verifyPassword("wrong1", encoded)).toBe(false);
  });
});

describe("session", () => {
  it("编解码往返", () => {
    const token = encodeSession({
      id: "user-admin-1",
      username: "admin",
      role: "admin",
      displayName: "管理员",
    });
    expect(token.includes(".")).toBe(true);
    const payload = decodeSession(token);
    expect(payload?.userId).toBe("user-admin-1");
    expect(payload?.role).toBe("admin");
  });

  it("篡改签名失败", () => {
    const token = encodeSession({
      id: "user-guest-01",
      username: "guest01",
      role: "guest",
      displayName: "体验账号 01",
    });
    const [body] = token.split(".");
    expect(decodeSession(`${body}.deadbeef`)).toBeNull();
  });
});
