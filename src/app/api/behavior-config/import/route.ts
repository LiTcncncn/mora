import { z } from "zod";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";
import { behaviorConfigRepository } from "@/server/config/behavior-repository";
import { buildCoverageMatrix } from "@/server/config/behavior-validate";
import { profileRepository } from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * §13.6.5 三阶段导入的 HTTP 面。
 *
 * `confirmed=false` 只跑阶段一与阶段二并返回预览；`confirmed=true` 才提交。
 * 这次确认**不可跳过，也不提供「记住我的选择」**——§18.1 已定不得静默覆盖
 * 用户旧配置，而一个可以被记住的确认等于没有确认。
 */

const bodySchema = z.object({
  profileId: z.string().min(1),
  /** 文件原文，不是解析后的对象：判别与严格校验都要从原文开始。 */
  fileContents: z.string().min(1).max(8 * 1024 * 1024),
  fileName: z.string().min(1).max(200),
  confirmed: z.boolean(),
});

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(bodySchema, await readJsonBody(request));
    const profile = await profileRepository.requireProfile(body.profileId);

    const preview = await behaviorConfigRepository.previewImport(
      body.profileId,
      profile.name,
      body.fileContents,
    );

    // 拒绝整包时也返回完整预览而不是只报错：只说「导入失败」而不说哪一条
    // 硬约束不满足，使用者无法修文件（§13.6.6）。
    if (!body.confirmed || preview.resolution.rejected) {
      return apiSuccess({ applied: false, preview: describe(preview) });
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
      preview: describe(preview),
      config,
      audit,
      backup,
      coverage: buildCoverageMatrix(config),
    });
  });
}

/**
 * 预览只回传摘要与判定，不回传整份候选配置。
 *
 * 候选配置留在服务端重新计算：把它发到浏览器再收回来，等于让客户端有机会
 * 篡改一份已经通过校验的配置。
 */
function describe(
  preview: Awaited<ReturnType<typeof behaviorConfigRepository.previewImport>>,
) {
  return {
    kind: preview.kind,
    sourceGeneration: preview.sourceGeneration,
    sourceProfileName: preview.sourceProfileName,
    declaredConfigHash: preview.declaredConfigHash,
    recomputedConfigHash: preview.recomputedConfigHash,
    hashMismatch: preview.hashMismatch,
    downgrades: preview.downgrades,
    rejected: preview.resolution.rejected,
    rejectionReasons: preview.resolution.rejectionReasons,
    autoDisabled: preview.resolution.autoDisabled,
    warnings: preview.resolution.warnings,
    strategyOverrides: preview.strategyOverrides,
    changeSummary: preview.changeSummary,
    migration: preview.migration,
    labRuntimeSummary: preview.labRuntimeSummary,
  };
}
