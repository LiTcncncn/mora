import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type FewShotSample, fewShotSampleSchema } from "@/domain/fewshot";
import { parseFewShotText } from "@/domain/fewshot-text";
import { AppError } from "@/server/api/errors";
import {
  apiSuccess,
  handleRoute,
  parseWith,
  readJsonBody,
} from "@/server/api/response";
import { fewShotRepository } from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  profileId: z.string().min(1),
  text: z.string(),
});

/** 只比较人能编辑的字段：全都没变就不动 updatedAt，避免一次保存刷掉整份时间戳。 */
function isUnchanged(existing: FewShotSample, next: FewShotSample): boolean {
  return (
    existing.scene === next.scene &&
    existing.energy === next.energy &&
    existing.worldview === next.worldview &&
    existing.enabled === next.enabled &&
    existing.user === next.user &&
    existing.reply === next.reply &&
    existing.note === next.note &&
    existing.keywords.length === next.keywords.length &&
    existing.keywords.every((keyword, index) => keyword === next.keywords[index])
  );
}

export async function PUT(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const body = parseWith(bodySchema, await readJsonBody(request));
    const { records, issues } = parseFewShotText(body.text);

    if (issues.length > 0) {
      throw new AppError(
        "VALIDATION_ERROR",
        `文本有 ${issues.length} 处问题，第一处在第 ${issues[0]!.line} 行：${issues[0]!.message}`,
        {
          fieldErrors: Object.fromEntries(
            issues.map((issue) => [`第 ${issue.line} 行`, [issue.message]]),
          ),
        },
      );
    }

    const existing = await fewShotRepository.list(body.profileId);
    const byId = new Map(existing.map((item) => [item.id, item]));
    const timestamp = new Date().toISOString();

    let created = 0;
    let updated = 0;
    let unchanged = 0;

    const next = records.map((record) => {
      const previous = record.id ? byId.get(record.id) : undefined;
      const candidate = fewShotSampleSchema.parse({
        ...record,
        id: previous?.id ?? `fs-${randomUUID()}`,
        profileId: body.profileId,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
      });
      if (!previous) {
        created += 1;
        return candidate;
      }
      if (isUnchanged(previous, candidate)) {
        unchanged += 1;
        return previous;
      }
      updated += 1;
      return candidate;
    });

    const keptIds = new Set(next.map((sample) => sample.id));
    const deleted = existing.filter((item) => !keptIds.has(item.id)).length;

    const items = await fewShotRepository.replaceForProfile(
      body.profileId,
      next,
    );
    return apiSuccess({ items, created, updated, unchanged, deleted });
  });
}
