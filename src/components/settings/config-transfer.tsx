"use client";

import { useRef, useState } from "react";
import type { ConfigImportSummary } from "@/domain/config-bundle";
import { Collapsible, Notice } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";
import { labelOf, PROVIDER_LABELS } from "@/lib/labels";

interface ImportResponse {
  applied: boolean;
  summary: ConfigImportSummary;
}

export function ConfigTransfer({
  profileId,
  onImported,
}: {
  profileId: string;
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [bundle, setBundle] = useState<unknown>(null);
  const [summary, setSummary] = useState<ConfigImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const preview = async (file: File): Promise<void> => {
    setError(null);
    setStatus(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = await api.post<ImportResponse>("/api/config/import", {
        profileId,
        bundle: parsed,
        confirmed: false,
      });
      setBundle(parsed);
      setSummary(result.summary);
    } catch (caught) {
      setBundle(null);
      setSummary(null);
      setError(errorMessage(caught));
    }
  };

  const apply = async (): Promise<void> => {
    if (!bundle) return;
    try {
      await api.post<ImportResponse>("/api/config/import", {
        profileId,
        bundle,
        confirmed: true,
      });
      setBundle(null);
      setSummary(null);
      setStatus(
        "配置已导入并覆盖当前档案的设置、Persona 人格与 Prompt Preset 提示词预设。",
      );
      if (inputRef.current) inputRef.current.value = "";
      onImported();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <Collapsible title="配置导出与导入">
      <div className="space-y-3">
        <Notice>
          配置文件只包含设置、Persona 人格、Prompt Preset 提示词预设与 Few-shot 示例语料，不含 API Key 接口密钥、对话、Memory 记忆或 run 运行记录。安全底线由程序提供，不会被配置文件覆盖。
        </Notice>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {status ? <Notice>{status}</Notice> : null}

        <a
          className="btn inline-flex"
          href={`/api/config/export?profileId=${encodeURIComponent(profileId)}`}
          download
        >
          导出当前档案配置
        </a>

        <div className="space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept="application/json"
            className="block text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void preview(file);
            }}
          />

          {summary ? (
            <div className="card space-y-2 p-3 text-sm">
              <p>
                来源档案：{summary.sourceProfileName}（导出于 {summary.exportedAt}）
              </p>
              <p>
                将写入 {summary.personaCount} 个 Persona 人格与{" "}
                {summary.promptPresetCount} 个 Prompt Preset 提示词预设，覆盖当前档案已有的{" "}
                {summary.replacesPersonaCount} 个 Persona 人格与{" "}
                {summary.replacesPromptPresetCount} 个 Preset 预设。
              </p>
              <p>
                {summary.fewShotSampleCount === null
                  ? `这份配置不含 Few-shot 示例字段，当前档案已有的 ${summary.replacesFewShotSampleCount} 条示例会原样保留。`
                  : `Few-shot 示例：写入 ${summary.fewShotSampleCount} 条，覆盖已有的 ${summary.replacesFewShotSampleCount} 条。`}
              </p>
              <ul className="text-[var(--color-muted)]">
                {summary.modelSlots.map((slot, index) => (
                  <li key={`${slot.label}-${index}`}>
                    槽位 {slot.label}：{labelOf(PROVIDER_LABELS, slot.provider)} ·{" "}
                    {slot.modelId}
                  </li>
                ))}
              </ul>
              <button type="button" className="btn btn-primary" onClick={() => void apply()}>
                确认导入
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </Collapsible>
  );
}
