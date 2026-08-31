"use client";

import { useEffect, useState } from "react";
import type { RunSummary } from "@/domain/run";
import type { SettingsData } from "@/domain/settings";
import { useProfiles } from "@/components/app-shell/profile-context";
import { Notice } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";
import { labelOf, PROVIDER_LABELS } from "@/lib/labels";

export function Overview() {
  const { activeProfile, activeProfileId, providerStatus } = useProfiles();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [memoryCount, setMemoryCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProfileId) return;
    void (async () => {
      try {
        const query = `profileId=${encodeURIComponent(activeProfileId)}`;
        const [loadedSettings, runPage, memories] = await Promise.all([
          api.get<SettingsData>(`/api/settings?${query}`),
          api.get<{ items: RunSummary[] }>(`/api/runs?${query}&limit=200`),
          api.get<Array<{ status: string }>>(`/api/memories?${query}`),
        ]);
        setSettings(loadedSettings);
        setRuns(runPage.items);
        setMemoryCount(memories.length);
        setError(null);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    })();
  }, [activeProfileId]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!settings) return <p className="text-sm">加载中…</p>;

  const enabledSlots = settings.compare.modelSlots.filter((slot) => slot.enabled);
  const failed = runs.filter((run) => run.status === "failed").length;
  const missingKeys = enabledSlots.filter(
    (slot) => providerStatus && !providerStatus[slot.provider].configured,
  );

  return (
    <div className="space-y-4">
      {missingKeys.length > 0 ? (
        <Notice tone="error">
          以下启用槽位对应的供应商尚未配置 API Key 接口密钥：
          {missingKeys.map((slot) => slot.label).join("、")}
          。请在项目根目录的 .env.local 中配置后重启开发服务器。
        </Notice>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="当前档案" value={activeProfile?.name ?? "—"} />
        <Stat label="启用模型槽位" value={`${enabledSlots.length} 个`} />
        <Stat
          label="最近 run 运行记录"
          value={`${runs.length} 条，失败 ${failed} 条`}
        />
        <Stat label="Memory 记忆条目" value={`${memoryCount} 条`} />
      </dl>

      <div className="card p-3 text-sm">
        <p className="font-medium">本轮参与比较的模型</p>
        <ul className="mt-2 space-y-1 text-[var(--color-muted)]">
          {enabledSlots.map((slot) => (
            <li key={slot.id}>
              {slot.label}：{labelOf(PROVIDER_LABELS, slot.provider)} ·{" "}
              {slot.modelId}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <dt className="label">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}
