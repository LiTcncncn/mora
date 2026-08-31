import { handleRoute, requireQueryParam } from "@/server/api/response";
import { exportConfigBundle } from "@/server/config/bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 返回可下载的 JSON 文件，不含任何密钥或用户内容。 */
export async function GET(request: Request): Promise<Response> {
  return handleRoute(async () => {
    const profileId = requireQueryParam(request, "profileId");
    const bundle = await exportConfigBundle(profileId);
    const fileName = `mora-config-${bundle.exportedAt.slice(0, 10)}.json`;

    return new Response(`${JSON.stringify(bundle, null, 2)}\n`, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  });
}
