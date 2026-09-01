"use client";

import { useState } from "react";
import type { Persona } from "@/domain/persona";
import type { PromptPreset } from "@/domain/prompt";
import type { SettingsData } from "@/domain/settings";
import { ConfirmButton, Field, Notice } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";

/**
 * 人格与提示词预设都支持多条，Settings 里靠 activePersonaId / activePromptPresetId
 * 选择，但此前没有任何界面入口，等于只能用一条。这里提供切换、复制、删除，
 * 让策划可以留住一版再改另一版做对照。
 */
export function ActiveSelector({
  profileId,
  personas,
  presets,
  settings,
  dirty,
  onReload,
}: {
  profileId: string;
  personas: Persona[];
  presets: PromptPreset[];
  settings: SettingsData;
  /** 有未保存改动时切换会丢失编辑，先挡住。 */
  dirty: boolean;
  onReload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 只改这两个 id，其余设置先重新读一遍再写回，免得覆盖设置页刚存的改动。 */
  const patchSettings = async (
    next: Partial<Pick<SettingsData, "activePersonaId" | "activePromptPresetId">>,
  ): Promise<void> => {
    const current = await api.get<SettingsData>(
      `/api/settings?profileId=${encodeURIComponent(profileId)}`,
    );
    await api.put("/api/settings", {
      profileId,
      settings: { ...current, ...next },
    });
  };

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onReload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const duplicatePersona = async (): Promise<void> => {
    const source = personas.find((item) => item.id === settings.activePersonaId);
    if (!source) return;
    const created = await api.post<Persona>("/api/personas", {
      profileId,
      persona: {
        name: `${source.name} 副本`,
        description: source.description,
        corePrompt: source.corePrompt,
        traits: source.traits,
        style: source.style,
        relationshipFraming: source.relationshipFraming,
        boundaries: source.boundaries,
      },
    });
    await patchSettings({ activePersonaId: created.id });
  };

  const duplicatePreset = async (): Promise<void> => {
    const source = presets.find(
      (item) => item.id === settings.activePromptPresetId,
    );
    if (!source) return;
    const created = await api.post<PromptPreset>("/api/prompt-presets", {
      profileId,
      preset: {
        name: `${source.name} 副本`,
        description: source.description,
        sections: source.sections,
      },
    });
    await patchSettings({ activePromptPresetId: created.id });
  };

  return (
    <div className="card space-y-3 p-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {dirty ? (
        <Notice tone="warning">
          有未保存的改动。切换或复制会以已保存的内容为准，当前编辑将丢失。
        </Notice>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`当前 Persona 人格（共 ${personas.length} 条）`}>
          <div className="flex gap-2">
            <select
              className="field"
              disabled={busy}
              value={settings.activePersonaId}
              onChange={(event) =>
                void run(() =>
                  patchSettings({ activePersonaId: event.target.value }),
                )
              }
            >
              {personas.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void run(duplicatePersona)}
            >
              复制一版
            </button>
            {personas.length > 1 ? (
              <ConfirmButton
                label="删除"
                confirmLabel="确认删除"
                onConfirm={() =>
                  void run(async () => {
                    await api.delete(
                      `/api/personas/${settings.activePersonaId}?profileId=${encodeURIComponent(profileId)}`,
                    );
                  })
                }
              />
            ) : null}
          </div>
        </Field>

        <Field label={`当前 Prompt 预设（共 ${presets.length} 条）`}>
          <div className="flex gap-2">
            <select
              className="field"
              disabled={busy}
              value={settings.activePromptPresetId}
              onChange={(event) =>
                void run(() =>
                  patchSettings({ activePromptPresetId: event.target.value }),
                )
              }
            >
              {presets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}（v{item.version}）
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void run(duplicatePreset)}
            >
              复制一版
            </button>
            {presets.length > 1 ? (
              <ConfirmButton
                label="删除"
                confirmLabel="确认删除"
                onConfirm={() =>
                  void run(async () => {
                    await api.delete(
                      `/api/prompt-presets/${settings.activePromptPresetId}?profileId=${encodeURIComponent(profileId)}`,
                    );
                  })
                }
              />
            ) : null}
          </div>
        </Field>
      </div>

      <p className="text-xs text-[var(--color-muted)]">
        「复制一版」会立刻切到副本，原版原样留着，适合改之前先存一份对照。
        当前在用的那条不能删，先切换再删。
      </p>
    </div>
  );
}
