import { handleRoute, requireQueryParam } from "@/server/api/response";
import { AppError } from "@/server/api/errors";
import { behaviorConfigRepository } from "@/server/config/behavior-repository";
import {
  buildConfigExport,
  buildExampleLibraryExport,
  buildExportFileName,
  buildWorldviewLibraryExport,
  serializeExport,
  type TransferKind,
} from "@/server/config/behavior-transfer";
import { fetchLabRuntimeExport } from "@/server/config/lab-runtime-transfer";
import { profileRepository } from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: readonly TransferKind[] = [
  "mora_behavior_config",
  "mora_worldview_library",
  "mora_example_library",
];

/**
 * §13.6.1：三种导出粒度。
 *
 * 返回可下载的 JSON 文件。内容按白名单序列化，不含凭据、用户数据或历史事实
 * （§13.6.7）。
 */
export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const profileId = requireQueryParam(request, "profileId");
    const kind = (new URL(request.url).searchParams.get("kind") ??
      "mora_behavior_config") as TransferKind;

    if (!KINDS.includes(kind)) {
      throw new AppError("VALIDATION_ERROR", `不支持的导出粒度 kind=${kind}`);
    }

    const profile = await profileRepository.requireProfile(profileId);
    const config = await behaviorConfigRepository.get(profileId, profile.name);

    const now = new Date();
    const exportedAt = now.toISOString();
    const payload =
      kind === "mora_behavior_config"
        ? buildConfigExport(
            config,
            exportedAt,
            await fetchLabRuntimeExport(profileId),
          )
        : kind === "mora_worldview_library"
          ? buildWorldviewLibraryExport(config, exportedAt)
          : buildExampleLibraryExport(config, exportedAt);

    const fileName = buildExportFileName(
      kind,
      config.sourceProfileName,
      config.configHash,
      now,
    );

    return new Response(serializeExport(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // 文件名含非 ASCII 档案名，必须同时给 filename* 的 RFC 5987 形式。
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  });
}
