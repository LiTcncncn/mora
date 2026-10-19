import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AccountRole, PublicSessionUser } from "@/domain/accounts";
import { getSessionSecret } from "@/server/config/env";

export const SESSION_COOKIE_NAME = "zhaka_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export type SessionPayload = {
  userId: string;
  username: string;
  role: AccountRole;
  displayName: string;
  exp: number;
};

function sign(body: string): string {
  return createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
}

export function encodeSession(user: PublicSessionUser): string {
  const payload: SessionPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSession(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (!payload.exp || payload.exp < Date.now()) return null;
    if (!payload.userId || !payload.role) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeSeconds = SESSION_TTL_MS / 1000) {
  return {
    httpOnly: true,
    // 当前公网为 HTTP，暂不 Secure；上 HTTPS 后改为 true
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function toPublicFromSession(session: SessionPayload): PublicSessionUser {
  return {
    id: session.userId,
    username: session.username,
    role: session.role,
    displayName: session.displayName,
  };
}
