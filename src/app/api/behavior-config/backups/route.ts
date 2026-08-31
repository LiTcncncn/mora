import { z } from "zod";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";
import { listBackups, readBackup } from "@/server/config/behavior-backup";
import { behaviorConfigRepository } from "@/server/config/behavior-repository";
import { buildCoverageMatrix } from "@/server/config/behavior-validate";
import { profileRepository } from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** §13.6.9：备份列表与一键恢复。 */
export async function GET(): Promise<Response> {
  return handleRoute(async () => apiSuccess({ items: await listBackups() }));
}

const restoreBodySchema = z.object({
  profileId: z.string().min(1),
  fileName: z.string().min(1).max(200),
  confirmed: z.boolean(),
});

/**
 * 恢复走与导入**完全相同**的三阶段流程，不走捷径。
 *
 * 捷径会绕过校验，而备份文件同样可能被手工编辑过——它就放在 `data/` 下，
 * 格式与正常导出一致，正是为了方便人直接改。
 */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(restoreBodySchema, await readJsonBody(request));
    const profile = await profileRepository.requireProfile(body.profileId);

    const contents = await readBackup(body.fileName);
    const preview = await behaviorConfigRepository.previewImport(
      body.profileId,
      profile.name,
      contents,
    );

    if (!body.confirmed || preview.resolution.rejected) {
      return apiSuccess({
        applied: false,
        rejected: preview.resolution.rejected,
        rejectionReasons: preview.resolution.rejectionReasons,
        downgrades: preview.downgrades,
        changeSummary: preview.changeSummary,
        warnings: preview.resolution.warnings,
      });
    }

    const { config, audit, backup } =
      await behaviorConfigRepository.commitImport(
        body.profileId,
        profile.name,
        preview,
        body.fileName,
      );

    return apiSuccess({
      applied: true,
      config,
      audit,
      // 恢复本身也会先备份当前配置，因此恢复动作同样是可撤销的。
      backup,
      coverage: buildCoverageMatrix(config),
    });
  });
}
