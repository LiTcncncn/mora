import { z } from "zod";
import { behaviorConfigV2Schema } from "@/domain/behavior-config";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
  requireQueryParam,
} from "@/server/api/response";
import { behaviorConfigRepository } from "@/server/config/behavior-repository";
import {
  buildCoverageMatrix,
  validateBehaviorConfig,
  resolveForSave,
} from "@/server/config/behavior-validate";
import { profileRepository } from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 活动 Behavior Config v2 的读写。
 *
 * 自 Phase 1 起 Settings 与说明面只读写 v2 配置，v1 配置冻结为只读仅供回滚
 * （D41）。中间阶段不允许两套配置同时编辑——同时改两套产生的漂移无法对齐，
 * 也会让 v1/v2 的对比失去意义。
 */

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const profileId = requireQueryParam(request, "profileId");
    const profile = await profileRepository.requireProfile(profileId);

    const config = await behaviorConfigRepository.get(profileId, profile.name);
    const resolution = resolveForSave(validateBehaviorConfig(config));

    return apiSuccess({
      config,
      /** 只读项必须可见并可复制，用于解释行为；不可见等于无法调试（§13.5）。 */
      warnings: resolution.warnings,
      blockedFromEnabling: resolution.blockedFromEnabling,
      coverage: buildCoverageMatrix(config),
      persisted: await behaviorConfigRepository.has(profileId),
    });
  });
}

const saveBodySchema = z.object({
  profileId: z.string().min(1),
  config: behaviorConfigV2Schema,
});

/** 服务端重新完整校验，不信任浏览器端校验结果。 */
export async function PUT(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(saveBodySchema, await readJsonBody(request));
    const profile = await profileRepository.requireProfile(body.profileId);

    const { config, resolution, bumped } = await behaviorConfigRepository.save(
      body.profileId,
      profile.name,
      body.config,
    );

    return apiSuccess({
      config,
      // 客户端传来的 version 与 configHash 一律被忽略并重算，因此必须把
      // 实际自增的字段回传，否则界面上的版本号会与存档不一致。
      bumpedVersions: bumped,
      warnings: resolution.warnings,
      blockedFromEnabling: resolution.blockedFromEnabling,
      coverage: buildCoverageMatrix(config),
    });
  });
}
