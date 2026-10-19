import { apiSuccess, handleRoute } from "@/server/api/response";
import { appendUsageLog } from "@/server/auth/usage-log";
import { readSession } from "@/server/auth/require-auth";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  return handleRoute(async () => {
    const session = await readSession();
    if (session) {
      await appendUsageLog({
        userId: session.userId,
        role: session.role,
        event: "logout",
        ok: true,
      });
    }
    const response = apiSuccess({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, "", {
      ...sessionCookieOptions(0),
      maxAge: 0,
    });
    return response;
  });
}
