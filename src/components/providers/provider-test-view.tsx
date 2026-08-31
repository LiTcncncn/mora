"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProviderId } from "@/domain/common";
import type { SettingsData } from "@/domain/settings";
import { useProfiles } from "@/components/app-shell/profile-context";
import { Field, Notice, SectionTitle } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";

type StepStatus = "ok" | "failed" | "skipped";

interface DiagnosticStep {
  id: string;
  label: string;
  status: StepStatus;
  detail: string;
  latencyMs: number | null;
}

interface DiagnosticResult {
  provider: ProviderId;
  modelId: string;
  baseUrl: string;
  steps: DiagnosticStep[];
  conclusion: string;
  availableModels: string[];
}

interface CallResult {
  ok: boolean;
  latencyMs: number;
  text: string;
}

const STATUS_MARK: Record<StepStatus, string> = {
  ok: "通过",
  failed: "失败",
  skipped: "跳过",
};

const STATUS_CLASS: Record<StepStatus, string> = {
  ok: "",
  failed: "text-[var(--color-danger)]",
  skipped: "text-[var(--color-muted)]",
};

const PROVIDER_OPTIONS: Array<{ value: ProviderId; label: string }> = [
  { value: "kimi", label: "Kimi" },
  { value: "deepseek", label: "DeepSeek" },
];

export function ProviderTestView() {
  const { activeProfileId, providerStatus } = useProfiles();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [provider, setProvider] = useState<ProviderId>("kimi");
  const [modelId, setModelId] = useState("");
  const [running, setRunning] = useState<"none" | "diagnose" | "call">("none");
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [callResult, setCallResult] = useState<CallResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProfileId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api.get<SettingsData>(
          `/api/settings?profileId=${encodeURIComponent(activeProfileId)}`,
        );
        if (!cancelled) {
          setSettings(data);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeProfileId]);

  const knownModels = useMemo(() => {
    if (!settings) return [] as string[];
    const ids = settings.compare.modelSlots
      .filter((slot) => slot.provider === provider)
      .map((slot) => slot.modelId);
    ids.push(settings.providers[provider].modelId);
    if (settings.memory.autoCandidateExtraction.provider === provider) {
      ids.push(settings.memory.autoCandidateExtraction.modelId);
    }
    return [...new Set(ids)];
  }, [settings, provider]);

  useEffect(() => {
    const first = knownModels[0];
    if (first) setModelId(first);
  }, [knownModels]);

  const reset = () => {
    setResult(null);
    setCallResult(null);
    setError(null);
  };

  const runDiagnose = useCallback(async () => {
    if (!modelId.trim()) {
      setError("请先填写要测试的模型 ID");
      return;
    }
    reset();
    setRunning("diagnose");
    try {
      setResult(
        await api.post<DiagnosticResult>("/api/providers/diagnose", {
          provider,
          modelId: modelId.trim(),
        }),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRunning("none");
    }
  }, [provider, modelId]);

  const runRealCall = useCallback(async () => {
    if (!modelId.trim()) {
      setError("请先填写要测试的模型 ID");
      return;
    }
    setCallResult(null);
    setError(null);
    setRunning("call");
    const startedAt = Date.now();
    try {
      const response = await api.post<{
        ok: boolean;
        message: string;
        latencyMs: number | null;
      }>("/api/providers/test", { provider, modelId: modelId.trim() });
      setCallResult({
        ok: response.ok,
        latencyMs: response.latencyMs ?? Date.now() - startedAt,
        text: response.message,
      });
    } catch (caught) {
      setCallResult({
        ok: false,
        latencyMs: Date.now() - startedAt,
        text: errorMessage(caught),
      });
    } finally {
      setRunning("none");
    }
  }, [provider, modelId]);

  const configured = providerStatus?.[provider].configured ?? false;
  const busy = running !== "none";
  const ready = modelId.trim().length > 0;

  if (!activeProfileId) return <p className="text-sm">正在加载档案…</p>;

  return (
    <div className="space-y-4 pb-10">
      <Notice>
        分步检查网络、API Key 与模型 ID。每步最多等待 30 秒。超时只说明连不上供应商，不能据此判断密钥无效。
      </Notice>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="card space-y-4 p-4">
        <SectionTitle>测试选项</SectionTitle>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="供应商">
            <select
              className="field"
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value as ProviderId);
                reset();
              }}
            >
              {PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="模型 ID" hint="可从当前档案已配置的模型中选择，也可手动填写。">
            <input
              className="field"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              placeholder="例如 kimi-k2.6"
              list="mora-known-models"
            />
            <datalist id="mora-known-models">
              {knownModels.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          </Field>
        </div>

        <p className="text-sm text-[var(--color-muted)]">
          API Key 接口密钥：{configured ? "已配置" : "未配置"}
          {settings ? ` · 当前档案默认模型 ${settings.providers[provider].modelId}` : ""}
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void runDiagnose()}
            disabled={busy || !ready}
          >
            {running === "diagnose" ? "检测中…" : "开始检测"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void runRealCall()}
            disabled={busy || !ready}
          >
            {running === "call" ? "调用中…" : "真实调用一次"}
          </button>
        </div>

        <p className="text-xs text-[var(--color-muted)]">
          {ready
            ? "「开始检测」只读取模型列表，不产生生成费用；「真实调用一次」会真的生成一小段文本。"
            : "正在读取当前档案的模型配置…"}
        </p>
      </div>

      {result ? (
        <div className="card space-y-3 p-4">
          <SectionTitle>分步结果</SectionTitle>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="label">供应商</dt>
              <dd>{result.provider}</dd>
            </div>
            <div>
              <dt className="label">模型 ID</dt>
              <dd className="break-all">{result.modelId}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="label">请求地址</dt>
              <dd className="break-all">{result.baseUrl}</dd>
            </div>
          </dl>
          <ul className="space-y-3 text-sm">
            {result.steps.map((item) => (
              <li key={item.id} className="border-t pt-3 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={STATUS_CLASS[item.status]}>
                    {STATUS_MARK[item.status]}
                  </span>
                  <span>{item.label}</span>
                  {item.latencyMs !== null ? (
                    <span className="text-xs text-[var(--color-muted)]">
                      {item.latencyMs} ms
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[var(--color-muted)]">{item.detail}</p>
              </li>
            ))}
          </ul>
          <Notice>{result.conclusion}</Notice>
          {result.availableModels.length > 0 ? (
            <div>
              <p className="label">可用模型 {result.availableModels.length} 个</p>
              <p className="mt-1 text-sm break-words text-[var(--color-muted)]">
                {result.availableModels.join("、")}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {callResult ? (
        <div className="card space-y-2 p-4">
          <SectionTitle>真实调用</SectionTitle>
          <p
            className={`text-sm break-words ${
              callResult.ok ? "" : "text-[var(--color-danger)]"
            }`}
          >
            {callResult.ok ? "成功" : "失败"}（{callResult.latencyMs} ms）：
            {callResult.text}
          </p>
        </div>
      ) : null}
    </div>
  );
}
