"use client";

import { useEffect, useState } from "react";
import type { Persona } from "@/domain/persona";
import {
  TEMPLATE_VARIABLE_WHITELIST,
  validateTemplate,
  type PromptPreset,
} from "@/domain/prompt";
import type { SettingsData } from "@/domain/settings";
import { useProfiles } from "@/components/app-shell/profile-context";
import { Collapsible, Field, Notice, SectionTitle } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";
import { labelOf, PERSONA_TRAIT_LABELS } from "@/lib/labels";
import { SAFETY_BASELINE, SAFETY_BASELINE_TITLE } from "@/domain/safety";

export function StudioView() {
  const { activeProfileId } = useProfiles();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [preset, setPreset] = useState<PromptPreset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = async (profileId: string): Promise<void> => {
    try {
      const loadedSettings = await api.get<SettingsData>(
        `/api/settings?profileId=${encodeURIComponent(profileId)}`,
      );
      const query = `profileId=${encodeURIComponent(profileId)}`;
      const [loadedPersona, loadedPreset] = await Promise.all([
        api.get<Persona>(`/api/personas/${loadedSettings.activePersonaId}?${query}`),
        api.get<PromptPreset>(
          `/api/prompt-presets/${loadedSettings.activePromptPresetId}?${query}`,
        ),
      ]);
      setSettings(loadedSettings);
      setPersona(loadedPersona);
      setPreset(loadedPreset);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  useEffect(() => {
    if (!activeProfileId) return;
    setStatus(null);
    void load(activeProfileId);
  }, [activeProfileId]);

  const savePersona = async (): Promise<void> => {
    if (!activeProfileId || !persona) return;
    try {
      await api.put(`/api/personas/${persona.id}`, {
        profileId: activeProfileId,
        persona,
      });
      setStatus("Persona 人格已保存");
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const savePreset = async (): Promise<void> => {
    if (!activeProfileId || !preset) return;
    try {
      const saved = await api.put<PromptPreset>(
        `/api/prompt-presets/${preset.id}`,
        { profileId: activeProfileId, preset },
      );
      setPreset(saved);
      setStatus(`Prompt Preset 提示词预设已保存，版本 ${saved.version}`);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  if (!activeProfileId) return <p className="text-sm">正在加载档案…</p>;
  if (error && !persona) return <Notice tone="error">{error}</Notice>;
  if (!persona || !preset || !settings) return <p className="text-sm">加载中…</p>;

  return (
    <div className="space-y-4 pb-10">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {status ? <Notice>{status}</Notice> : null}

      <Collapsible title={SAFETY_BASELINE_TITLE} defaultOpen>
        <Notice>
          安全底线由程序提供，永远排在上下文最前，无法在此编辑，也不会被导入的配置文件覆盖。
        </Notice>
        <pre className="mt-2 overflow-x-auto rounded border bg-[var(--color-canvas)] p-2 text-xs whitespace-pre-wrap">
          {SAFETY_BASELINE}
        </pre>
      </Collapsible>

      <Collapsible title="Persona 人格" defaultOpen>
        <div className="space-y-3">
          <Field label="名称">
            <input
              className="field"
              value={persona.name}
              onChange={(event) =>
                setPersona({ ...persona, name: event.target.value })
              }
            />
          </Field>
          <Field label="核心 Prompt 提示词">
            <textarea
              className="field min-h-60"
              value={persona.corePrompt}
              onChange={(event) =>
                setPersona({ ...persona, corePrompt: event.target.value })
              }
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-5">
            {(
              ["warmth", "humor", "initiative", "directness", "playfulness"] as const
            ).map((trait) => (
              <Field
                key={trait}
                label={`${labelOf(PERSONA_TRAIT_LABELS, trait)}：${persona.traits[trait]}`}
              >
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  className="w-full"
                  value={persona.traits[trait]}
                  onChange={(event) =>
                    setPersona({
                      ...persona,
                      traits: {
                        ...persona.traits,
                        [trait]: Number(event.target.value),
                      },
                    })
                  }
                />
              </Field>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="默认回复长度">
              <select
                className="field"
                value={persona.style.defaultReplyLength}
                onChange={(event) =>
                  setPersona({
                    ...persona,
                    style: {
                      ...persona.style,
                      defaultReplyLength: event.target
                        .value as Persona["style"]["defaultReplyLength"],
                    },
                  })
                }
              >
                <option value="very_short">very_short 极短</option>
                <option value="short">short 短</option>
                <option value="medium">medium 中等</option>
                <option value="long">long 长</option>
              </select>
            </Field>
            <Field label="emoji 表情符号">
              <select
                className="field"
                value={persona.style.emojiMode}
                onChange={(event) =>
                  setPersona({
                    ...persona,
                    style: {
                      ...persona.style,
                      emojiMode: event.target.value as Persona["style"]["emojiMode"],
                    },
                  })
                }
              >
                <option value="none">none 不使用</option>
                <option value="rare">rare 极少</option>
                <option value="light">light 少量</option>
              </select>
            </Field>
            <Field label="提问频率">
              <select
                className="field"
                value={persona.style.questionFrequency}
                onChange={(event) =>
                  setPersona({
                    ...persona,
                    style: {
                      ...persona.style,
                      questionFrequency: event.target
                        .value as Persona["style"]["questionFrequency"],
                    },
                  })
                }
              >
                <option value="low">low 低</option>
                <option value="medium">medium 中</option>
                <option value="high">high 高</option>
              </select>
            </Field>
          </div>

          <Field label="关系定位" hint="建议弱化排他与依赖性表达。">
            <textarea
              className="field min-h-16"
              value={persona.relationshipFraming}
              onChange={(event) =>
                setPersona({ ...persona, relationshipFraming: event.target.value })
              }
            />
          </Field>

          <Field label="避免的表达" hint="每行一条。">
            <textarea
              className="field min-h-24"
              value={persona.style.avoidPatterns.join("\n")}
              onChange={(event) =>
                setPersona({
                  ...persona,
                  style: {
                    ...persona.style,
                    avoidPatterns: event.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          </Field>

          <Field label="边界" hint="每行一条。">
            <textarea
              className="field min-h-24"
              value={persona.boundaries.join("\n")}
              onChange={(event) =>
                setPersona({
                  ...persona,
                  boundaries: event.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>

          <button type="button" className="btn btn-primary" onClick={() => void savePersona()}>
            保存 Persona 人格
          </button>
        </div>
      </Collapsible>

      <Collapsible
        title={`Prompt 提示词分区（版本 ${preset.version}）`}
        defaultOpen
      >
        <div className="space-y-3">
          <p className="text-xs text-[var(--color-muted)]">
            可用变量：
            {TEMPLATE_VARIABLE_WHITELIST.map((variable) => `{{${variable}}}`).join(
              "、",
            )}
            。模板只做字符串替换，不执行任何表达式。
          </p>

          {preset.sections.map((section, index) => {
            const validation = validateTemplate(section.template);
            return (
              <div
                key={section.id}
                data-testid="prompt-section"
                data-section-id={section.id}
                className="card space-y-2 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SectionTitle>
                    {index + 1}. {section.title}
                  </SectionTitle>
                  {section.editable ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={section.enabled}
                        onChange={(event) =>
                          setPreset({
                            ...preset,
                            sections: preset.sections.map((item, position) =>
                              position === index
                                ? { ...item, enabled: event.target.checked }
                                : item,
                            ),
                          })
                        }
                      />
                      启用
                    </label>
                  ) : (
                    <span className="text-xs text-[var(--color-muted)]">
                      只读，始终启用
                    </span>
                  )}
                </div>

                {section.editable ? (
                  <>
                    <textarea
                      className="field min-h-28"
                      value={section.template}
                      onChange={(event) =>
                        setPreset({
                          ...preset,
                          sections: preset.sections.map((item, position) =>
                            position === index
                              ? { ...item, template: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                    {!validation.ok ? (
                      <Notice tone="error">
                        未知变量：{validation.unknownVariables.join("、")}
                      </Notice>
                    ) : null}
                  </>
                ) : (
                  <pre className="overflow-x-auto rounded border bg-[var(--color-canvas)] p-2 text-xs whitespace-pre-wrap">
                    {SAFETY_BASELINE}
                  </pre>
                )}
              </div>
            );
          })}

          <button type="button" className="btn btn-primary" onClick={() => void savePreset()}>
            保存 Prompt Preset 提示词预设
          </button>
        </div>
      </Collapsible>
    </div>
  );
}
