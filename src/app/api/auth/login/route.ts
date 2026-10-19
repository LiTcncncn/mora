import { z } from "zod";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";
import { AppError } from "@/server/api/errors";
import { findAccountByUsername, toPublicUser } from "@/server/auth/accounts";
import { verifyPassword } from "@/server/auth/password";
import { appendUsageLog } from "@/server/auth/usage-log";
import {
  SESSION_COOKIE_NAME,
  encodeSession,
  sessionCookieOptions,
} from "@/server/auth/session";
import { ensureBootstrapped } from "@/server/persistence/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    await ensureBootstrapped();
    const body = parseWith(bodySchema, await readJsonBody(request));
    const account = await findAccountByUsername(body.username);
    // 统一失败文案，不区分用户是否存在
    if (!account || !verifyPassword(body.password, account.passwordHash)) {
      throw new AppError("UNAUTHORIZED", "用户名或密码错误", { httpStatus: 401 });
    }
    const publicUser = toPublicUser(account);
    const token = encodeSession(publicUser);
    await appendUsageLog({
      userId: publicUser.id,
      role: publicUser.role,
      event: "login",
      ok: true,
    });
    const response = apiSuccess({ user: publicUser });
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
    return response;
  });
}
