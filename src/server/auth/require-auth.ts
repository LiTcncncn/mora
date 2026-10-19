import "server-only";
import { cookies } from "next/headers";
import type { AccountRole, PublicSessionUser } from "@/domain/accounts";
import { AppError } from "@/server/api/errors";
import {
  SESSION_COOKIE_NAME,
  decodeSession,
  toPublicFromSession,
  type SessionPayload,
} from "./session";

export async function readSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE_NAME)?.value);
}

export async function requireAuth(): Promise<PublicSessionUser> {
  const session = await readSession();
  if (!session) {
    throw new AppError("UNAUTHORIZED", "请先登录");
  }
  return toPublicFromSession(session);
}

export async function requireRole(
  ...roles: AccountRole[]
): Promise<PublicSessionUser> {
  const user = await requireAuth();
  if (!roles.includes(user.role)) {
    throw new AppError("FORBIDDEN", "没有权限执行该操作");
  }
  return user;
}

export async function requireAdmin(): Promise<PublicSessionUser> {
  return requireRole("admin");
}
