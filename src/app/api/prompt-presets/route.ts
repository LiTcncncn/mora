import { randomUUID } from "node:crypto";
import { z } from "zod";
import { promptPresetSchema, validateTemplate } from "@/domain/prompt";
import { AppError } from "@/server/api/errors";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
  requireQueryParam,
} from "@/server/api/response";
import { promptPresetRepository } from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  profileId: z.string().min(1),
  preset: promptPresetSchema.omit({
    id: true,
    profileId: true,
    version: true,
    createdAt: true,
    updatedAt: true,
  }),
});

/** 未知模板变量必须阻止保存。 */
export function assertTemplatesValid(
  sections: Array<{ title: string; template: string; editable: boolean }>,
): void {
  for (const section of sections) {
    if (!section.editable) continue;
    const validation = validateTemplate(section.template);
    if (!validation.ok) {
      throw new AppError(
        "VALIDATION_ERROR",
        `分区「${section.title}」包含未知变量：${validation.unknownVariables.join(", ")}`,
      );
    }
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const profileId = requireQueryParam(request, "profileId");
    return apiSuccess(await promptPresetRepository.list(profileId));
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(createSchema, await readJsonBody(request));
    assertTemplatesValid(body.preset.sections);
    const timestamp = new Date().toISOString();
    const created = await promptPresetRepository.create({
      ...body.preset,
      id: `preset-${randomUUID()}`,
      profileId: body.profileId,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return apiSuccess(created, 201);
  });
}
