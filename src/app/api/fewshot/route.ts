import {
  apiSuccess,
  handleRoute,
  requireQueryParam,
} from "@/server/api/response";
import { fewShotRepository } from "@/server/persistence/repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 写入走 /api/fewshot/bulk：语料整份用文本编辑，没有单条增删改。 */
export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const profileId = requireQueryParam(request, "profileId");
    return apiSuccess(await fewShotRepository.list(profileId));
  });
}
