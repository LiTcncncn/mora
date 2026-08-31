import "server-only";
import type { ProviderId } from "@/domain/common";
import {
  getDeepSeekApiKey,
  getDeepSeekBaseUrl,
  getKimiApiKey,
  getKimiBaseUrl,
  getSecretValues,
} from "../config/env";
import { sanitizeText } from "../observability/sanitize";
import { DIAGNOSE_TIMEOUT_MS, fetchWithConnectTimeout } from "./timed-fetch";

export type DiagnosticStepId = "config" | "network" | "auth" | "model";

export interface DiagnosticStep {
  id: DiagnosticStepId;
  label: string;
  status: "ok" | "failed" | "skipped";
  detail: string;
  latencyMs: number | null;
}

export interface DiagnosticResult {
  provider: ProviderId;
  modelId: string;
  baseUrl: string;
  steps: DiagnosticStep[];
  conclusion: string;
  availableModels: string[];
}

const STEP_LABELS: Record<DiagnosticStepId, string> = {
  config: "config 密钥配置",
  network: "network 网络连通",
  auth: "auth 密钥有效性",
  model: "model 模型可用性",
};

function step(
  id: DiagnosticStepId,
  status: DiagnosticStep["status"],
  detail: string,
  latencyMs: number | null = null,
): DiagnosticStep {
  return { id, label: STEP_LABELS[id], status, detail, latencyMs };
}

function providerConfig(provider: ProviderId): {
  apiKey: string | null;
  baseUrl: string;
} {
  return provider === "kimi"
    ? { apiKey: getKimiApiKey(), baseUrl: getKimiBaseUrl() }
    : { apiKey: getDeepSeekApiKey(), baseUrl: getDeepSeekBaseUrl() };
}

async function fetchModels(
  baseUrl: string,
  apiKey: string | null,
  timeoutMs: number,
): Promise<Response> {
  return fetchWithConnectTimeout(
    `${baseUrl.replace(/\/$/, "")}/models`,
    {
      method: "GET",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    },
    timeoutMs,
  );
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

function isTlsNameMismatch(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (current instanceof Error) {
      const blob = `${"code" in current ? String(current.code) : ""} ${current.message}`;
      if (/ERR_TLS_CERT_ALTNAME_INVALID|altnames/i.test(blob)) return true;
      current = current.cause;
      continue;
    }
    break;
  }
  return false;
}

function describeFetchError(error: unknown): string {
  if (isAbortError(error)) return "请求超时，规定时间内没有收到任何响应";
  if (isTlsNameMismatch(error)) {
    return "TLS 证书与主机名不匹配：解析到了别人的服务器（常见于 IPv6/DNS 污染），并不是连上了目标供应商";
  }

  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof Error) {
      const code =
        "code" in current && typeof current.code === "string"
          ? current.code
          : null;
      if (code) parts.push(code);
      if (current.message && current.message !== "fetch failed") {
        parts.push(current.message);
      }
      current = current.cause;
      continue;
    }
    break;
  }

  const unique = [...new Set(parts.map((part) => part.trim()).filter(Boolean))];
  if (unique.length === 0) return "fetch failed";
  return sanitizeText(unique.join(" · "), getSecretValues()).slice(0, 240);
}

/**
 * 分步诊断，用于区分「网络不通」「密钥无效」「模型不可用」三类完全不同的失败。
 * 只调用 /models 列表接口，不产生生成 token 费用。
 */
export async function diagnoseProvider(
  provider: ProviderId,
  modelId: string,
  timeouts: { networkMs?: number; authMs?: number } = {},
): Promise<DiagnosticResult> {
  const networkMs = timeouts.networkMs ?? DIAGNOSE_TIMEOUT_MS;
  const authMs = timeouts.authMs ?? DIAGNOSE_TIMEOUT_MS;
  const { apiKey, baseUrl } = providerConfig(provider);
  const steps: DiagnosticStep[] = [];
  const availableModels: string[] = [];

  if (!apiKey) {
    steps.push(
      step("config", "failed", "本机 .env.local 中没有配置该供应商的 API Key"),
      step("network", "skipped", "未配置密钥，跳过"),
      step("auth", "skipped", "未配置密钥，跳过"),
      step("model", "skipped", "未配置密钥，跳过"),
    );
    return {
      provider,
      modelId,
      baseUrl,
      steps,
      conclusion:
        "该供应商尚未配置 API Key。请在项目根目录的 .env.local 中填写后重启开发服务器。",
      availableModels,
    };
  }

  steps.push(step("config", "ok", "已在服务端读取到 API Key"));

  // 不带密钥请求一次：只要拿到任意 HTTP 响应，就说明网络可达。
  const networkStartedAt = Date.now();
  try {
    const probe = await fetchModels(baseUrl, null, networkMs);
    steps.push(
      step(
        "network",
        "ok",
        `可以访问 ${baseUrl}，返回 HTTP ${probe.status}`,
        Date.now() - networkStartedAt,
      ),
    );
  } catch (error) {
    steps.push(
      step(
        "network",
        "failed",
        `无法访问 ${baseUrl}：${describeFetchError(error)}`,
        Date.now() - networkStartedAt,
      ),
      step("auth", "skipped", "网络不通，无法判断密钥是否有效"),
      step("model", "skipped", "网络不通，跳过"),
    );
    return {
      provider,
      modelId,
      baseUrl,
      steps,
      conclusion: isTlsNameMismatch(error)
        ? "已经连上了一台服务器，但证书不是该供应商的。说明 DNS 仍指向错误 IP（本机常见情况是 IPv6 未走 VPN）。这不是 API Key 问题。请对比 dig A 与 dig AAAA；若只有 AAAA 是 Meta/Facebook 段地址，让 VPN 接管 IPv6 或暂时关闭 IPv6 后重启开发服务器。"
        : "网络层就失败了，本机根本没有连上该地址，因此无法判断 API Key 是否有效。超时通常是网络或代理问题，不是密钥写错。请检查网络、代理，或把该供应商的 base URL 改成可访问的兼容网关地址。",
      availableModels,
    };
  }

  const authStartedAt = Date.now();
  let modelList: string[] = [];
  try {
    const response = await fetchModels(baseUrl, apiKey, authMs);
    const latencyMs = Date.now() - authStartedAt;

    if (response.status === 401 || response.status === 403) {
      steps.push(
        step("auth", "failed", `密钥被拒绝，HTTP ${response.status}`, latencyMs),
        step("model", "skipped", "密钥无效，跳过"),
      );
      return {
        provider,
        modelId,
        baseUrl,
        steps,
        conclusion:
          "网络可达，但该 API Key 被供应商拒绝。请到供应商控制台确认密钥是否有效、是否已过期或被吊销。",
        availableModels,
      };
    }

    if (!response.ok) {
      steps.push(
        step("auth", "failed", `返回 HTTP ${response.status}`, latencyMs),
        step("model", "skipped", "密钥校验未通过，跳过"),
      );
      return {
        provider,
        modelId,
        baseUrl,
        steps,
        conclusion: `供应商返回了 HTTP ${response.status}，既不是认证失败也不是成功，请检查 base URL 是否指向正确的兼容接口。`,
        availableModels,
      };
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: string }>;
    };
    modelList = (payload.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string")
      .sort();

    steps.push(
      step("auth", "ok", `密钥有效，账号可用模型 ${modelList.length} 个`, latencyMs),
    );
  } catch (error) {
    steps.push(
      step("auth", "failed", describeFetchError(error), Date.now() - authStartedAt),
      step("model", "skipped", "密钥校验未完成，跳过"),
    );
    return {
      provider,
      modelId,
      baseUrl,
      steps,
      conclusion:
        "带密钥的请求失败了，但不带密钥时网络是通的。请重试一次，或检查 base URL 是否正确。",
      availableModels,
    };
  }

  availableModels.push(...modelList);

  if (modelList.length === 0) {
    steps.push(
      step("model", "skipped", "该接口没有返回模型列表，无法核对模型 ID"),
    );
    return {
      provider,
      modelId,
      baseUrl,
      steps,
      conclusion:
        "密钥有效，但该地址没有返回可用模型列表，请手动确认模型 ID 是否正确。",
      availableModels,
    };
  }

  if (modelList.includes(modelId)) {
    steps.push(step("model", "ok", `账号可以使用 ${modelId}`));
    return {
      provider,
      modelId,
      baseUrl,
      steps,
      conclusion: "全部检查通过，该槽位可以正常调用。",
      availableModels,
    };
  }

  steps.push(
    step("model", "failed", `账号可用模型中没有 ${modelId}`),
  );
  return {
    provider,
    modelId,
    baseUrl,
    steps,
    conclusion: `密钥有效，但你的账号没有 ${modelId} 这个模型。请从下方可用模型列表中挑一个，并到设置页修改对应槽位的模型 ID。`,
    availableModels,
  };
}
