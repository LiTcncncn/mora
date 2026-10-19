"use client";

import { useCallback, useEffect, useState } from "react";
import type { DeviceConfig, DeviceLogFile, DeviceStatusView } from "@/domain/device";
import type { VoiceId } from "@/domain/voice";
import { api, errorMessage } from "@/lib/api-client";
import { ConfirmButton, EmptyState, Field, Notice, SectionTitle } from "@/components/ui/primitives";

interface DevicesResponse {
  gatewayOnline: boolean;
  config: DeviceConfig;
  items: DeviceStatusView[];
  options: {
    templateProfileId: string;
    activePersonaId: string;
    personas: Array<{ id: string; name: string }>;
    modelSlots: Array<{ id: string; label: string; provider: string; modelId: string }>;
    voices: Array<{ id: VoiceId; label: string }>;
  };
}

function formatTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

export function DevicesView() {
  const [data, setData] = useState<DevicesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<DevicesResponse>("/api/devices"));
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [load]);

  const run = useCallback(
    async (task: () => Promise<unknown>, done?: string) => {
      try {
        await task();
        setError(null);
        if (done) setNotice(done);
        await load();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [load],
  );

  if (!data) {
    return error ? <Notice tone="error">{error}</Notice> : <EmptyState>正在读取设备…</EmptyState>;
  }

  return (
    <div className="space-y-6">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice>{notice}</Notice> : null}
      {!data.gatewayOnline ? (
        <Notice tone="warning">硬件网关未启动：只能查看登记记录和生成日志，改配置需要先启动网关。</Notice>
      ) : null}

      <ConfigCard data={data} onSave={(body) => run(() => api.put("/api/devices", body), "已同步到全部设备")} />

      <section className="space-y-3">
        <SectionTitle>设备（{data.items.length}）</SectionTitle>
        {data.items.length === 0 ? (
          <EmptyState>还没有设备连上过网关。烧录新固件、配好 Wi-Fi 后会自动出现在这里。</EmptyState>
        ) : (
          data.items
            .slice()
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map((device) => (
              <DeviceCard
                key={device.deviceId}
                device={device}
                gatewayOnline={data.gatewayOnline}
                run={run}
              />
            ))
        )}
      </section>
    </div>
  );
}

function ConfigCard({
  data,
  onSave,
}: {
  data: DevicesResponse;
  onSave: (body: { config: DeviceConfig; applyVolume: boolean }) => Promise<void>;
}) {
  const [config, setConfig] = useState<DeviceConfig>(data.config);
  const [applyVolume, setApplyVolume] = useState(false);
  const [saving, setSaving] = useState(false);
  const { options } = data;
  const activePersona = options.personas.find((persona) => persona.id === options.activePersonaId);

  return (
    <section className="card space-y-3 p-4">
      <SectionTitle>统一硬件配置</SectionTitle>
      <p className="text-xs text-[var(--color-muted)]">
        从模板档案 <code>{options.templateProfileId}</code> 复制 Persona、Prompt、行为配置到每台设备。
        在设置页或 Prompt Studio 改了模板后，回来点一次「保存并同步」才会生效到硬件。
      </p>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Persona">
          <select
            className="field"
            value={config.personaId ?? ""}
            onChange={(event) => setConfig({ ...config, personaId: event.target.value || null })}
          >
            <option value="">跟随模板当前（{activePersona?.name ?? "-"}）</option>
            {options.personas.map((persona) => (
              <option key={persona.id} value={persona.id}>
                {persona.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="模型">
          <select
            className="field"
            value={config.modelSlotId ?? ""}
            onChange={(event) => setConfig({ ...config, modelSlotId: event.target.value || null })}
          >
            <option value="">默认（第一个 DeepSeek）</option>
            {options.modelSlots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.label} · {slot.modelId}
              </option>
            ))}
          </select>
        </Field>
        <Field label="音色">
          <select
            className="field"
            value={config.voiceId}
            onChange={(event) => setConfig({ ...config, voiceId: event.target.value as VoiceId })}
          >
            {options.voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`新设备默认音量：${config.volume}`}>
          <input
            type="range"
            min={0}
            max={100}
            className="w-full"
            value={config.volume}
            onChange={(event) => setConfig({ ...config, volume: Number(event.target.value) })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={applyVolume}
            onChange={(event) => setApplyVolume(event.target.checked)}
          />
          同时把音量应用到所有设备
        </label>
        <button
          type="button"
          className="btn"
          disabled={saving || !data.gatewayOnline}
          onClick={async () => {
            setSaving(true);
            await onSave({ config, applyVolume });
            setSaving(false);
          }}
        >
          {saving ? "同步中…" : "保存并同步到全部设备"}
        </button>
      </div>
    </section>
  );
}

function DeviceCard({
  device,
  gatewayOnline,
  run,
}: {
  device: DeviceStatusView;
  gatewayOnline: boolean;
  run: (task: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const base = `/api/devices/${encodeURIComponent(device.deviceId)}`;
  const [name, setName] = useState(device.displayName);
  const [volume, setVolume] = useState(device.volume);
  const [logsOpen, setLogsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) setVolume(device.volume);
  }, [device.volume, dragging]);

  const commitVolume = () => {
    setDragging(false);
    if (volume !== device.volume) void run(() => api.patch(base, { volume }));
  };

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            device.online ? "bg-green-600" : "bg-[var(--color-muted)]"
          }`}
          title={device.online ? "在线" : "离线"}
        />
        <input
          className="field w-40"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed && trimmed !== device.displayName) {
              void run(() => api.patch(base, { displayName: trimmed }));
            } else {
              setName(device.displayName);
            }
          }}
        />
        <code className="text-xs">{device.deviceId}</code>
        <span className="text-xs text-[var(--color-muted)]">
          {device.online ? "在线" : `离线 · 最后在线 ${formatTime(device.lastSeenAt)}`} · 固件{" "}
          {device.firmwareVersion ?? "旧版"} · RSSI {device.lastRssi ?? "-"}
          {device.online && device.mic.ok === false ? " · 麦克风无数据" : ""}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-[var(--color-muted)]">音量 {volume}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            disabled={!gatewayOnline}
            onChange={(event) => {
              setDragging(true);
              setVolume(Number(event.target.value));
            }}
            onPointerUp={commitVolume}
            onKeyUp={commitVolume}
          />
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={device.enabled}
            disabled={!gatewayOnline}
            onChange={(event) => void run(() => api.patch(base, { enabled: event.target.checked }))}
          />
          允许对话
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn"
          disabled={!device.online}
          onClick={() => void run(() => api.post(base, { action: "haptic" }), `${device.displayName} 已震动`)}
        >
          测试震动
        </button>
        <ConfirmButton
          label="远程进入配网"
          confirmLabel="确认：设备将重启并开热点"
          disabled={!device.online}
          onConfirm={() =>
            run(
              () => api.post(base, { action: "provision" }),
              `${device.displayName} 正在重启进入配网，热点名 ZHAKA-${device.deviceId.slice(-4).toUpperCase()}`,
            )
          }
        />
        <ConfirmButton
          label="归档对话并重新开始"
          confirmLabel="确认归档（记忆保留）"
          disabled={!gatewayOnline}
          onConfirm={() => run(() => api.post(base, { action: "archive" }), `${device.displayName} 已开始新对话`)}
        />
        <button type="button" className="btn" onClick={() => setLogsOpen((open) => !open)}>
          {logsOpen ? "收起日志" : "设备日志"}
        </button>
      </div>

      {logsOpen ? <DeviceLogs deviceId={device.deviceId} /> : null}
    </div>
  );
}

function DeviceLogs({ deviceId }: { deviceId: string }) {
  const base = `/api/devices/${encodeURIComponent(deviceId)}/logs`;
  const [files, setFiles] = useState<DeviceLogFile[]>([]);
  const [viewing, setViewing] = useState<{ fileName: string; markdown: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setFiles(await api.get<DeviceLogFile[]>(base));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-2 border-t pt-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const created = await api.post<DeviceLogFile & { markdown: string }>(base);
              setViewing({ fileName: created.fileName, markdown: created.markdown });
              await refresh();
              setError(null);
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "生成中…" : "生成日志文档"}
        </button>
        <span className="text-xs text-[var(--color-muted)]">包含全部对话、能量、时延和记忆</span>
      </div>
      {files.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {files.map((file) => (
            <li key={file.fileName} className="flex items-center gap-3">
              <code>{file.fileName}</code>
              <span className="text-xs text-[var(--color-muted)]">{(file.sizeBytes / 1024).toFixed(1)} KB</span>
              <button
                type="button"
                className="underline"
                onClick={async () => {
                  try {
                    setViewing(
                      await api.get<{ fileName: string; markdown: string }>(
                        `${base}?file=${encodeURIComponent(file.fileName)}`,
                      ),
                    );
                  } catch (caught) {
                    setError(errorMessage(caught));
                  }
                }}
              >
                查看
              </button>
              <a className="underline" href={`${base}?file=${encodeURIComponent(file.fileName)}&download=1`}>
                下载
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {viewing ? (
        <div className="rounded border">
          <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
            <code>{viewing.fileName}</code>
            <button type="button" className="underline" onClick={() => setViewing(null)}>
              关闭
            </button>
          </div>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words p-3 text-xs">
            {viewing.markdown}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
