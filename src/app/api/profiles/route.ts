import { z } from "zod";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";
import { AppError } from "@/server/api/errors";
import { requireAdmin, requireAuth } from "@/server/auth/require-auth";
import { profileRepository } from "@/server/persistence/repositories";
import { ensureBootstrapped } from "@/server/persistence/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({ name: z.string().min(1).max(80) });

export async function GET(): Promise<Response> {
  return handleRoute(async () => {
    await requireAuth();
    await ensureBootstrapped();
    return apiSuccess(await profileRepository.list());
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    await requireAdmin();
    // 消费 body，避免客户端挂起；产品已取消多配置档案。
    parseWith(createSchema, await readJsonBody(request));
    throw new AppError(
      "FORBIDDEN",
      "已取消本地测试档案：服务器只保留一份生效配置",
    );
  });
}
