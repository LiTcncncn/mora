import { afterEach, describe, expect, it, vi } from "vitest";
import { diagnoseProvider } from "./diagnostics";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("diagnoseProvider", () => {
  it("网络超时不得被当成密钥无效", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("This operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }),
    );

    const result = await diagnoseProvider("kimi", "kimi-k2.6", {
      networkMs: 50,
    });

    expect(result.steps.find((step) => step.id === "network")?.status).toBe(
      "failed",
    );
    expect(result.steps.find((step) => step.id === "auth")?.status).toBe(
      "skipped",
    );
    expect(result.conclusion).toContain("无法判断 API Key 是否有效");
    expect(result.conclusion).not.toContain("密钥被供应商拒绝");
  });

  it("401 判定为密钥无效", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        if (!headers?.Authorization) return jsonResponse(401, {});
        return jsonResponse(401, { error: { message: "invalid" } });
      }),
    );

    const result = await diagnoseProvider("kimi", "kimi-k2.6");

    expect(result.steps.find((step) => step.id === "network")?.status).toBe("ok");
    expect(result.steps.find((step) => step.id === "auth")?.status).toBe(
      "failed",
    );
    expect(result.conclusion).toContain("API Key 被供应商拒绝");
  });

  it("密钥有效但模型不在账号列表中", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, { data: [{ id: "gpt-4.1-mini" }, { id: "gpt-4o" }] }),
      ),
    );

    const result = await diagnoseProvider("kimi", "kimi-k2.6");

    expect(result.steps.find((step) => step.id === "auth")?.status).toBe("ok");
    expect(result.steps.find((step) => step.id === "model")?.status).toBe(
      "failed",
    );
    expect(result.availableModels).toEqual(["gpt-4.1-mini", "gpt-4o"]);
    expect(result.conclusion).toContain("没有 kimi-k2.6");
  });

  it("全部通过时给出明确结论", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { data: [{ id: "kimi-k2.6" }] })),
    );

    const result = await diagnoseProvider("kimi", "kimi-k2.6");

    expect(result.steps.every((step) => step.status === "ok")).toBe(true);
    expect(result.conclusion).toContain("全部检查通过");
  });
});
