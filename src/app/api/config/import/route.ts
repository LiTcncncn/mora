import { AppError } from "@/server/api/errors";
import { handleRoute } from "@/server/api/response";
import { requireAdmin } from "@/server/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * v1 配置的导入自 Phase 1 起冻结（D41）。
 */
export async function POST(): Promise<Response> {
  return handleRoute(async () => {
    await requireAdmin();
    throw new AppError(
      "CONFLICT",
      "v1 配置已冻结为只读，请改用 v2 导入入口；v1 配置文件可直接在那里导入，系统会先生成迁移预览",
    );
  });
}
