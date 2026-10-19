import { z } from "zod";
import {
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";
import { AppError } from "@/server/api/errors";
import { requireAdmin } from "@/server/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  setActive: z.boolean().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, _context: Params): Promise<Response> {
  return handleRoute(async () => {
    await requireAdmin();
    parseWith(updateSchema, await readJsonBody(request));
    throw new AppError(
      "FORBIDDEN",
      "已取消本地测试档案：服务器只保留一份生效配置",
    );
  });
}

export async function DELETE(
  _request: Request,
  _context: Params,
): Promise<Response> {
  return handleRoute(async () => {
    await requireAdmin();
    throw new AppError(
      "FORBIDDEN",
      "已取消本地测试档案：服务器只保留一份生效配置",
    );
  });
}
