import { AppError } from "@/server/api/errors";
import { handleRoute } from "@/server/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * v1 配置的导入自 Phase 1 起冻结（D41）。
 *
 * 中间阶段不允许两套配置同时编辑——同时改两套产生的漂移无法对齐，也会让
 * v1/v2 的对比失去意义。
 *
 * 冻结不损失能力：v1 文件仍然可以导入，走 `/api/behavior-config/import`
 * 的迁移路径（§13.6.2 第 3 条），并且那条路径会产出迁移报告与预览确认，
 * 比这里的直接覆盖更安全。
 *
 * 导出仍保留（`/api/config/export`），供回滚时取回 v1 配置。
 */
export async function POST(): Promise<Response> {
  return handleRoute(() => {
    throw new AppError(
      "CONFLICT",
      "v1 配置已冻结为只读，请改用 v2 导入入口；v1 配置文件可直接在那里导入，系统会先生成迁移预览",
    );
  });
}
