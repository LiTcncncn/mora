import { apiSuccess, handleRoute } from "@/server/api/response";
import { requireAdmin } from "@/server/auth/require-auth";
import { generateDeviceLog, listDeviceLogs, readDeviceLog } from "@/server/devices/device-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 无参数：列出已生成的日志；?file=：读取一份；再加 &download=1 直接下载。 */
export async function GET(request: Request, context: Params): Promise<Response> {
  return handleRoute(async () => {
    await requireAdmin();
    const { id } = await context.params;
    const url = new URL(request.url);
    const file = url.searchParams.get("file");
    if (!file) return apiSuccess(await listDeviceLogs(id));

    const markdown = await readDeviceLog(id, file);
    if (url.searchParams.get("download") === "1") {
      return new Response(markdown, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${id}-${file}"`,
        },
      });
    }
    return apiSuccess({ fileName: file, markdown });
  });
}

export async function POST(_request: Request, context: Params): Promise<Response> {
  return handleRoute(async () => {
    await requireAdmin();
    const { id } = await context.params;
    return apiSuccess(await generateDeviceLog(id));
  });
}
